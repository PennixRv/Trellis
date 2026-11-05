"""Trellis task phase state, stored in task.json.meta.task_workflow."""

from __future__ import annotations

import argparse
import contextlib
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .git import run_git
from .io import read_json_checked, write_json
from .paths import FILE_TASK_JSON, get_repo_root
from .task_utils import is_within_tasks_dir, resolve_task_dir, run_task_hooks


PHASE_IDS = (
    "goal_exploration_and_requirements",
    "decision_space_construction_and_merging",
    "solution_design_and_convergence",
    "task_implementation",
    "delivery_review_and_closeout",
)
PHASE_ID_SET = set(PHASE_IDS)
ROUTE_REVISION = re.compile(r"^[1-9][0-9]*$")
EMPTY_ARTIFACT_REVISION = hashlib.sha256(b"[]").hexdigest()


class TaskWorkflowError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _required_text(value: str | None, field: str) -> str:
    if not value or not value.strip() or "\0" in value:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", f"{field} is required")
    return value.strip()


def _refs(values: list[str] | None, field: str, required: bool = False) -> list[str]:
    result = [_required_text(value, field) for value in values or []]
    if required and not result:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", f"at least one {field} is required")
    if len(set(result)) != len(result):
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", f"{field} contains duplicates")
    return result


def _task_dir(value: str) -> Path:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(value, repo_root)
    if task_dir is None or not is_within_tasks_dir(task_dir, repo_root):
        raise TaskWorkflowError("TASK_PHASE_TASK_NOT_FOUND", f"active task directory not found: {value}")
    return task_dir


def _load(task_dir: Path, *, initialize_meta: bool = False) -> tuple[dict, dict]:
    task_file = task_dir / FILE_TASK_JSON
    data, reason = read_json_checked(task_file)
    if data is None:
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"cannot read {task_file}: {reason}")
    # Explicit initialization may adopt legacy records; malformed metadata still fails.
    if initialize_meta and "meta" not in data:
        data["meta"] = {}
    meta = data.get("meta")
    if not isinstance(meta, dict):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task.meta must be an object")
    return data, meta


def _state(meta: dict) -> dict:
    state = meta.get("task_workflow")
    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise TaskWorkflowError("TASK_PHASE_NOT_INITIALIZED", "task phase workflow is not initialized")
    if not isinstance(state.get("phases"), dict) or not isinstance(state.get("phase_ids"), list):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task phase workflow has an invalid shape")
    try:
        _validate_route(",".join(state["phase_ids"]))
        _validate_classification(
            state.get("task_kind"),
            state.get("complexity"),
            state.get("project_context"),
            state["phase_ids"],
        )
    except (TypeError, TaskWorkflowError) as error:
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task phase classification or route is invalid") from error
    if not ROUTE_REVISION.fullmatch(str(state.get("task_route_revision", ""))) or not ROUTE_REVISION.fullmatch(str(state.get("input_revision", ""))):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task phase revision is invalid")
    admission = state.get("route_dependency_admission")
    if admission is not None and (
        not isinstance(admission, dict)
        or not ROUTE_REVISION.fullmatch(str(admission.get("task_route_revision", "")))
        or admission.get("admission_state") not in {"ready", "missing", "stale", "incompatible", "blocked"}
        or not isinstance(admission.get("dependencies"), list)
        or not admission["dependencies"]
        or any(not isinstance(value, str) or not value.strip() for value in admission["dependencies"])
        or len(set(admission["dependencies"])) != len(admission["dependencies"])
        or not isinstance(admission.get("evidence_refs"), list)
        or any(not isinstance(value, str) or not value.strip() for value in admission["evidence_refs"])
        or len(set(admission["evidence_refs"])) != len(admission["evidence_refs"])
    ):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "route dependency admission has an invalid shape")
    if state.get("current_phase_id") is not None and state["current_phase_id"] not in state["phase_ids"]:
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "current phase is not in the task route")
    for phase_id in state["phase_ids"]:
        record = state["phases"].get(phase_id)
        if not isinstance(record, dict) or record.get("status") not in {"not_started", "active", "waiting_user", "blocked", "accepted", "skipped"}:
            raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"task phase record is invalid: {phase_id}")
        if phase_id == PHASE_IDS[0] and record.get("status") == "accepted":
            acceptance = record.get("acceptance")
            if (
                not isinstance(acceptance, dict)
                or acceptance.get("artifact_revision") != record.get("artifact_revision")
                or not isinstance(acceptance.get("evidence_refs"), list)
                or not acceptance["evidence_refs"]
            ):
                raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "accepted Goal Exploration and Requirements Confirmation Phase must retain confirmation for its current artifact revision")
    return state


def implementation_start_ready(data: dict, task_dir: Path) -> bool:
    meta = data.get("meta")
    state = meta.get("task_workflow") if isinstance(meta, dict) else None
    if not isinstance(state, dict) or state.get("current_phase_id") != PHASE_IDS[3]:
        return False
    phase_ids = state.get("phase_ids")
    if not isinstance(phase_ids, list) or PHASE_IDS[3] not in phase_ids:
        return False
    phases = state.get("phases")
    implementation = phases.get(PHASE_IDS[3]) if isinstance(phases, dict) else None
    if not isinstance(implementation, dict) or implementation.get("status") != "active":
        return False
    if state.get("task_kind") not in {"implementation", "combined"}:
        return False
    authorization = state.get("implementation_authorization")
    contract_ref = authorization.get("contract_ref") if isinstance(authorization, dict) else None
    approval_ref = authorization.get("approval_ref") if isinstance(authorization, dict) else None
    if (
        not isinstance(authorization, dict)
        or authorization.get("task_route_revision") != state.get("task_route_revision")
        or not isinstance(contract_ref, str)
        or not contract_ref.strip()
        or not isinstance(approval_ref, str)
        or not approval_ref.strip()
    ):
        return False
    _require_current_requirements_confirmation(task_dir, state)
    _require_current_accepted_artifacts(task_dir, state)
    if PHASE_IDS[2] not in phase_ids:
        skip_records = state.get("skip_records")
        skipped_design = skip_records.get(PHASE_IDS[2]) if isinstance(skip_records, dict) else None
        evidence = skipped_design.get("evidence_refs") if isinstance(skipped_design, dict) else None
        return isinstance(evidence, list) and contract_ref in evidence
    design = state.get("phases", {}).get(PHASE_IDS[2])
    if not (
        isinstance(design, dict)
        and design.get("status") == "accepted"
        and design.get("outcome_kind") == "implementation_contract"
        and design.get("result_ref") == contract_ref
    ):
        return False
    artifact_refs = design.get("artifact_refs")
    if not isinstance(artifact_refs, list) or any(not isinstance(ref, str) for ref in artifact_refs):
        return False
    if _artifact_digest(task_dir, artifact_refs) != design.get("artifact_revision"):
        raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "Solution Design and Convergence Phase implementation contract changed after acceptance; refresh and accept the current artifact before implementation")
    return True


def _save(task_file: Path, data: dict) -> None:
    from .task_continuity import assert_task_mutation_allowed

    assert_task_mutation_allowed(get_repo_root(), task_file.parent, data)
    if not write_json(task_file, data):
        raise TaskWorkflowError("TASK_PHASE_WRITE_FAILED", f"could not update {task_file}")


@contextlib.contextmanager
def _task_lock(task_dir: Path):
    lock_file = get_repo_root() / ".trellis/.runtime/task-phase" / f"{task_dir.name}.lock"
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    with lock_file.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            if handle.read(1) == b"":
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _expected_route(state: dict, value: str | None) -> None:
    expected = _required_text(value, "--expected-route-revision")
    if expected != state.get("task_route_revision"):
        raise TaskWorkflowError(
            "TASK_PHASE_STALE_ROUTE",
            f"expected route revision {expected}, current revision is {state.get('task_route_revision')}",
        )


def _phase(state: dict, phase_id: str | None = None) -> tuple[str, dict]:
    current = phase_id or state.get("current_phase_id")
    if current not in PHASE_ID_SET or current not in state["phase_ids"]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_PHASE", f"phase is not in the current route: {current}")
    record = state["phases"].get(current)
    if not isinstance(record, dict):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"missing state for phase {current}")
    if phase_id is not None and current != state.get("current_phase_id"):
        raise TaskWorkflowError("TASK_PHASE_NOT_CURRENT", f"current phase is {state.get('current_phase_id')}")
    return current, record


def _is_withdrawal_route(state: dict) -> bool:
    requirements = state["phases"].get(PHASE_IDS[0], {})
    withdrawal = state.get("return_record")
    skip_records = state.get("skip_records")
    skipped_requirements = skip_records.get(PHASE_IDS[0]) if isinstance(skip_records, dict) else None
    return (
        state["phase_ids"] == [PHASE_IDS[0], PHASE_IDS[4]]
        and state.get("current_phase_id") in {PHASE_IDS[4], None}
        and isinstance(requirements, dict)
        and (
            requirements.get("status") == "accepted"
            or (
                requirements.get("status") == "skipped"
                and isinstance(skipped_requirements, dict)
                and skipped_requirements.get("task_route_revision") == state.get("task_route_revision")
            )
        )
        and isinstance(withdrawal, dict)
        and isinstance(withdrawal.get("from"), str)
        and withdrawal["from"] in PHASE_ID_SET
        and withdrawal.get("to") == PHASE_IDS[4]
        and withdrawal.get("task_route_revision") == state.get("task_route_revision")
        and isinstance(withdrawal.get("evidence_refs"), list)
        and bool(withdrawal["evidence_refs"])
    )


def _require_current_requirements_confirmation(task_dir: Path, state: dict) -> None:
    if PHASE_IDS[0] not in state["phase_ids"]:
        return
    requirements = state["phases"].get(PHASE_IDS[0], {})
    if requirements.get("status") == "skipped" and _is_withdrawal_route(state):
        return
    acceptance = requirements.get("acceptance") if isinstance(requirements, dict) else None
    if (
        not isinstance(acceptance, dict)
        or requirements.get("status") != "accepted"
        or acceptance.get("artifact_revision") != requirements.get("artifact_revision")
        or not isinstance(acceptance.get("evidence_refs"), list)
        or not acceptance["evidence_refs"]
    ):
        raise TaskWorkflowError("TASK_PHASE_USER_CONFIRMATION_REQUIRED", "Goal Exploration and Requirements Confirmation Phase must be accepted with explicit user confirmation before continuing")
    current_revision = _artifact_digest(task_dir, requirements.get("artifact_refs", []))
    if current_revision != requirements["artifact_revision"]:
        raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "Goal Exploration and Requirements Confirmation Phase artifacts changed after user confirmation; return to Goal Exploration and Requirements Confirmation Phase and obtain confirmation for the current revision")


def _next_phase(state: dict, phase_id: str) -> str | None:
    index = state["phase_ids"].index(phase_id)
    return state["phase_ids"][index + 1] if index + 1 < len(state["phase_ids"]) else None


def _advance(state: dict, phase_id: str) -> None:
    state["route_dependency_admission"] = None
    following = _next_phase(state, phase_id)
    state["current_phase_id"] = following
    if following is not None:
        state["phases"][following]["status"] = "active"
        state["phases"][following]["input_revision"] = state["input_revision"]


def _invalidate_from(state: dict, first_phase: str, keep_first: bool = False) -> None:
    state["route_dependency_admission"] = None
    first_index = PHASE_IDS.index(first_phase)
    for phase_id in state["phase_ids"]:
        if PHASE_IDS.index(phase_id) < first_index:
            continue
        state["skip_records"].pop(phase_id, None)
        record = state["phases"][phase_id]
        if keep_first and phase_id == first_phase:
            record["status"] = "active"
            record.update({
                "result_ref": None,
                "outcome_kind": None,
                "evidence_refs": [],
                "acceptance": None,
            })
        else:
            record.update({
                "status": "not_started",
                "result_ref": None,
                "outcome_kind": None,
                "reason": None,
                "evidence_refs": [],
                "acceptance": None,
            })
    state["current_phase_id"] = first_phase
    state["implementation_authorization"] = None
    state["closeout_disposition"] = None


def _artifact_digest(task_dir: Path, refs: list[str]) -> str:
    if not refs:
        return EMPTY_ARTIFACT_REVISION
    digest = hashlib.sha256()
    for value in sorted(refs):
        candidate = Path(value)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", f"artifact path must stay inside the task: {value}")
        full_path = task_dir / candidate
        try:
            resolved = full_path.resolve(strict=True)
            resolved.relative_to(task_dir.resolve())
            if full_path.is_symlink() or not resolved.is_file():
                raise OSError("not a regular file")
            content = resolved.read_bytes()
        except (OSError, ValueError) as error:
            raise TaskWorkflowError("TASK_PHASE_ARTIFACT_INVALID", f"cannot read task artifact {value}: {error}") from error
        digest.update(value.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def _require_current_accepted_artifacts(task_dir: Path, state: dict) -> None:
    for phase_id in state["phase_ids"]:
        record = state["phases"][phase_id]
        if record.get("status") != "accepted":
            continue
        refs = record.get("artifact_refs")
        if not isinstance(refs, list) or any(not isinstance(ref, str) for ref in refs):
            raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"accepted artifact references are invalid: {phase_id}")
        if _artifact_digest(task_dir, refs) != record.get("artifact_revision"):
            raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", f"accepted artifacts changed for {phase_id}; return to the affected phase and review the current candidate again")
    authorization = state.get("implementation_authorization")
    if authorization is not None:
        if not isinstance(authorization, dict) or not isinstance(authorization.get("contract_ref"), str):
            raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "implementation authorization has no contract reference")
        if _artifact_digest(task_dir, [authorization["contract_ref"]]) != authorization.get("contract_revision"):
            raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "implementation contract changed after authorization; review and authorize its current content before continuing")


def _validate_route(value: str | None) -> list[str]:
    raw = _required_text(value, "--phase-ids")
    phases = raw.split(",")
    if not phases or any(phase not in PHASE_ID_SET for phase in phases):
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--phase-ids must contain declared phase identifiers")
    if len(set(phases)) != len(phases) or phases != [phase for phase in PHASE_IDS if phase in phases]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--phase-ids must be unique and follow the defined phase order")
    if phases[0] != PHASE_IDS[0]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "Goal Exploration and Requirements Confirmation Phase must remain first")
    if phases[-1] != PHASE_IDS[-1]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--phase-ids must include Delivery Review and On-Site Closeout Phase")
    return phases


def _validate_classification(task_kind: str | None, complexity: str | None, project_context: str | None, phases: list[str]) -> None:
    if task_kind not in {"analysis", "implementation", "combined"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--task-kind must be analysis, implementation, or combined")
    if complexity not in {"simple", "standard", "complex"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--complexity must be simple, standard, or complex")
    if project_context not in {"new", "existing"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--project-context must be new or existing")
    if task_kind == "analysis" and PHASE_IDS[3] in phases:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "analysis tasks cannot include the Task Implementation and Test Verification Phase")


def _increment(value: str, allow_zero: bool = False) -> str:
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)" if allow_zero else ROUTE_REVISION.pattern, value):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"invalid revision value: {value}")
    return str(int(value) + 1)


def _phase_record(input_revision: str, status: str = "not_started") -> dict:
    return {
        "status": status,
        "input_revision": input_revision,
        "artifact_revision": EMPTY_ARTIFACT_REVISION,
        "artifact_refs": [],
        "result_revision": "0",
        "result_ref": None,
        "outcome_kind": None,
        "reason": None,
        "evidence_refs": [],
        "acceptance": None,
    }


def _init(args: argparse.Namespace, task_dir: Path, data: dict, meta: dict) -> int:
    if isinstance(meta.get("task_workflow"), dict):
        raise TaskWorkflowError("TASK_PHASE_ALREADY_INITIALIZED", "task phase workflow already exists")
    phases = _validate_route(args.phase_ids)
    omitted = [phase for phase in PHASE_IDS if phase not in phases]
    route_reason = args.route_reason
    route_evidence = _refs(args.route_evidence_ref, "--route-evidence-ref")
    if omitted:
        route_reason = _required_text(route_reason, "--route-reason")
        if not route_evidence:
            raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "an abbreviated route needs at least one --route-evidence-ref")
    elif route_reason or route_evidence:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "route rationale is only used when a phase is omitted")
    _validate_classification(args.task_kind, args.complexity, args.project_context, phases)
    input_revision = "1"
    meta["task_workflow"] = {
        "schema_version": 1,
        "task_route_revision": "1",
        "task_kind": args.task_kind,
        "complexity": args.complexity,
        "project_context": args.project_context,
        "phase_ids": phases,
        "current_phase_id": phases[0],
        "input_revision": input_revision,
        "phases": {phase: _phase_record(input_revision, "active" if phase == phases[0] else "not_started") for phase in phases},
        "route_dependency_admission": None,
        "implementation_authorization": None,
        "closeout_disposition": None,
        "skip_records": {
            phase: {"reason": route_reason, "evidence_refs": route_evidence, "task_route_revision": "1"}
            for phase in omitted
        },
        "return_record": None,
    }
    _save(task_dir / FILE_TASK_JSON, data)
    print(json.dumps(meta["task_workflow"], ensure_ascii=False))
    return 0


def _show(state: dict) -> int:
    print(json.dumps(state, ensure_ascii=False))
    return 0


def _require_acceptance_coverage(task_dir: Path, contract_ref: str) -> None:
    _artifact_digest(task_dir, [contract_ref])
    lines = (task_dir / contract_ref).read_text(encoding="utf-8").splitlines()
    heading = next((index for index, line in enumerate(lines) if line.strip() == "## 验收覆盖"), None)
    headers = ["接受条件", "工作包", "Owner", "验证入口", "交付证据", "停止条件"]
    if heading is not None:
        section = []
        for line in lines[heading + 1:]:
            if line.startswith("#"):
                break
            if line.strip():
                section.append(line.strip())
        rows = [line.strip("|").split("|") for line in section if line.startswith("|") and line.endswith("|")]
        rows = [[cell.strip() for cell in row] for row in rows]
        if (
            len(rows) >= 3
            and rows[0] == headers
            and len(rows[1]) == len(headers)
            and all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1])
            and all(len(row) == len(headers) and all(row) for row in rows[2:])
        ):
            return
    raise TaskWorkflowError("TASK_PHASE_COVERAGE_REQUIRED", "implementation contract requires ## 验收覆盖 with nonempty rows: " + " | ".join(headers))


def _update(args: argparse.Namespace, task_dir: Path, data: dict, state: dict) -> int:
    action = args.phase_action
    child_dispositions: dict[str, str] = {}
    if action == "show":
        return _show(state)

    if data.get("status") in {"completed", "cancelled"}:
        raise TaskWorkflowError("TASK_PHASE_TASK_TERMINAL", f"task is already {data['status']}")

    _expected_route(state, args.expected_route_revision)
    reviewed_delivery = (
        state.get("current_phase_id") is None
        and action in {"return", "route"}
        and state["phases"].get(PHASE_IDS[4], {}).get("status") == "accepted"
    )
    if reviewed_delivery:
        current, record = PHASE_IDS[4], state["phases"][PHASE_IDS[4]]
    else:
        current, record = _phase(state)
    accepted_design_return = action == "return" and current == PHASE_IDS[2] and record.get("status") == "accepted"
    returning_to_requirements = action == "return" and args.target_phase == PHASE_IDS[0]
    rerouting_to_requirements = action == "route" and args.target_phase == PHASE_IDS[0]
    if current != PHASE_IDS[0] and not returning_to_requirements and not rerouting_to_requirements:
        _require_current_requirements_confirmation(task_dir, state)
    if action not in {"show", "resume", "route", "authorize", "admission"} and record.get("status") != "active" and not reviewed_delivery and not accepted_design_return:
        raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "only the active phase can be changed")

    if action == "artifact":
        refs = _refs(args.artifact_ref, "--artifact-ref")
        revision = _artifact_digest(task_dir, refs)
        if revision != record["artifact_revision"] or refs != record["artifact_refs"]:
            state["route_dependency_admission"] = None
            record["artifact_revision"] = revision
            record["artifact_refs"] = refs
            state["input_revision"] = _increment(state["input_revision"])
            record["input_revision"] = state["input_revision"]
            record.update({"acceptance": None, "result_ref": None, "outcome_kind": None})
        _save(task_dir / FILE_TASK_JSON, data)
        print(json.dumps({"phase_id": current, "artifact_revision": revision, "input_revision": state["input_revision"]}))
        return 0

    if action in {"wait", "block"}:
        record["status"] = "waiting_user" if action == "wait" else "blocked"
        record["reason"] = _required_text(args.reason, "--reason")
        record["evidence_refs"] = _refs(args.evidence_ref, "--evidence-ref")
        record["outcome_kind"] = args.outcome_kind
        record["acceptance"] = None
    elif action == "admission":
        if current != PHASE_IDS[3]:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "route dependency admission is recorded at Task Implementation and Test Verification Phase")
        if args.admission_state is None:
            raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--admission-state is required for dependency admission")
        state["route_dependency_admission"] = {
            "task_route_revision": state["task_route_revision"],
            "dependencies": _refs(args.dependency, "--dependency", required=True),
            "admission_state": args.admission_state,
            "evidence_refs": _refs(args.evidence_ref, "--evidence-ref", required=True),
        }
    elif action == "resume":
        if record["status"] not in {"waiting_user", "blocked"}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "only a waiting or blocked phase can resume")
        record.update({"status": "active", "reason": None, "outcome_kind": None, "evidence_refs": [], "acceptance": None})
    elif action == "skip":
        reason = _required_text(args.reason, "--reason")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        if current == PHASE_IDS[0]:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "The Goal Exploration and Requirements Confirmation Phase must reach minimum alignment and acceptance and cannot be skipped")
        record.update({"status": "skipped", "reason": reason, "evidence_refs": evidence})
        state["skip_records"][current] = {"reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
        _advance(state, current)
    elif action == "accept":
        _require_current_accepted_artifacts(task_dir, state)
        artifact_revision = _required_text(args.artifact_revision, "--artifact-revision")
        current_revision = _artifact_digest(task_dir, record["artifact_refs"])
        if artifact_revision != record["artifact_revision"] or current_revision != record["artifact_revision"]:
            raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "artifact revision changed; refresh the phase artifact before acceptance")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        result_ref = _required_text(args.result_ref, "--result-ref")
        outcome = _required_text(args.outcome_kind, "--outcome-kind")
        if current == PHASE_IDS[0]:
            if outcome != "accepted":
                raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "Goal Exploration and Requirements Confirmation Phase can advance only with phase_result=accepted")
        if current == PHASE_IDS[2] and outcome not in {"implementation_contract", "analysis_conclusion", "no_go"}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "Solution Design and Convergence Phase must remain active for pending_user_decision or deferred; accept implementation_contract, analysis_conclusion, or no_go")
        if result_ref not in record["artifact_refs"]:
            raise TaskWorkflowError("TASK_PHASE_RESULT_NOT_BOUND", "--result-ref must be included in the current phase artifact refs")
        if current == PHASE_IDS[2] and outcome == "implementation_contract":
            _require_acceptance_coverage(task_dir, result_ref)
        if current == PHASE_IDS[3]:
            authorization = state.get("implementation_authorization")
            if not isinstance(authorization, dict) or authorization.get("task_route_revision") != state["task_route_revision"]:
                raise TaskWorkflowError("TASK_PHASE_IMPLEMENTATION_NOT_AUTHORIZED", "Task Implementation and Test Verification Phase requires a current implementation authorization")
        if current == PHASE_IDS[4]:
            if args.closeout_disposition not in {"delivery_ready", "no_go", "cancelled"}:
                raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "Delivery Review and On-Site Closeout Phase requires --closeout-disposition delivery_ready, no_go, or cancelled")
            if outcome != args.closeout_disposition:
                raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "Delivery Review and On-Site Closeout Phase outcome must match --closeout-disposition")
            if args.closeout_disposition == "cancelled":
                if not _is_withdrawal_route(state):
                    raise TaskWorkflowError("TASK_PHASE_USER_CONFIRMATION_REQUIRED", "cancellation closeout requires a user-confirmed route to Delivery Review and On-Site Closeout Phase")
            child_dispositions = _validate_child_dispositions(
                task_dir, data, args.closeout_disposition, args.child_disposition
            )
            state["closeout_disposition"] = args.closeout_disposition
        record["result_revision"] = _increment(record["result_revision"], allow_zero=True)
        record.update({"status": "accepted", "result_ref": result_ref, "outcome_kind": outcome, "reason": None, "evidence_refs": evidence})
        record["acceptance"] = {
            "artifact_revision": artifact_revision,
            "result_revision": record["result_revision"],
            "input_revision": record["input_revision"],
            "task_route_revision": state["task_route_revision"],
            "evidence_refs": evidence,
            **({"child_dispositions": child_dispositions} if current == PHASE_IDS[4] and child_dispositions else {}),
        }
        state["input_revision"] = _increment(state["input_revision"])
        # The authorization is the explicit boundary into implementation.
        if not (
            current == PHASE_IDS[2]
            and outcome == "implementation_contract"
            and PHASE_IDS[3] in state["phase_ids"]
        ):
            _advance(state, current)
    elif action == "return":
        target = _required_text(args.target_phase, "--target-phase")
        return_kind = args.return_kind
        execution_rework = return_kind == "execution_rework"
        if target not in state["phase_ids"] or (
            state["phase_ids"].index(target) >= state["phase_ids"].index(current)
            and not ((reviewed_delivery or accepted_design_return or execution_rework) and target == current)
        ):
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "return target must be an earlier phase in the current route")
        reason = _required_text(args.reason, "--reason")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        authorization = state.get("implementation_authorization")
        admission = state.get("route_dependency_admission")
        if execution_rework:
            if current not in PHASE_IDS[3:] or target not in PHASE_IDS[3:] or PHASE_IDS[3] not in state["phase_ids"]:
                raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "execution_rework is limited to implementation and delivery phases")
            candidate = copy.deepcopy(data)
            candidate_state = candidate["meta"]["task_workflow"]
            _invalidate_from(candidate_state, target, keep_first=True)
            candidate_state["implementation_authorization"] = authorization
            _require_current_accepted_artifacts(task_dir, candidate_state)
            candidate_state["current_phase_id"] = PHASE_IDS[3]
            candidate_state["phases"][PHASE_IDS[3]]["status"] = "active"
            if not implementation_start_ready(candidate, task_dir):
                raise TaskWorkflowError("TASK_PHASE_IMPLEMENTATION_NOT_AUTHORIZED", "execution_rework requires the unchanged authorized implementation contract")
            if admission is not None and (admission.get("admission_state") != "ready" or admission.get("task_route_revision") != state["task_route_revision"]):
                raise TaskWorkflowError("TASK_PHASE_ADMISSION_REQUIRED", "execution_rework requires current ready dependency admission")
        state["input_revision"] = _increment(state["input_revision"])
        _invalidate_from(state, target, keep_first=True)
        if execution_rework:
            state["implementation_authorization"] = authorization
            state["route_dependency_admission"] = admission
        state["phases"][target]["input_revision"] = state["input_revision"]
        state["return_record"] = {"from": current, "to": target, "return_kind": return_kind, "authorization_retained": execution_rework, "reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
    elif action == "route":
        phases = _validate_route(args.phase_ids)
        task_kind = args.task_kind if args.task_kind is not None else state["task_kind"]
        complexity = args.complexity if args.complexity is not None else state["complexity"]
        project_context = args.project_context if args.project_context is not None else state["project_context"]
        _validate_classification(task_kind, complexity, project_context, phases)
        reason = _required_text(args.reason, "--reason")
        target = _required_text(args.target_phase, "--target-phase")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        old_ids = state["phase_ids"]
        changed = [phase for phase in PHASE_IDS if (phase in old_ids) != (phase in phases)]
        classification_changed = any(
            new != state[field]
            for field, new in (
                ("task_kind", task_kind),
                ("complexity", complexity),
                ("project_context", project_context),
            )
        )
        withdrawal_route = (
            target == PHASE_IDS[4]
            and phases == [PHASE_IDS[0], PHASE_IDS[4]]
            and bool(evidence)
        )
        if not changed and not classification_changed and target == current and not reviewed_delivery:
            raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "the updated route and target are unchanged")
        earliest_change = min((PHASE_IDS.index(phase) for phase in changed), default=PHASE_IDS.index(target))
        if target not in PHASE_ID_SET or (PHASE_IDS.index(target) > earliest_change and not withdrawal_route):
            raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--target-phase must cover the earliest affected route change")
        omitted = [phase for phase in PHASE_IDS if phase not in phases]
        old_phases = state["phases"]
        previous_current = state.get("current_phase_id")
        state["task_route_revision"] = _increment(state["task_route_revision"])
        state["input_revision"] = _increment(state["input_revision"])
        state["task_kind"] = task_kind
        state["complexity"] = complexity
        state["project_context"] = project_context
        state["phase_ids"] = phases
        state["phases"] = {phase: old_phases.get(phase, _phase_record(state["input_revision"])) for phase in phases}
        affected = [phase for phase in phases if PHASE_IDS.index(phase) >= PHASE_IDS.index(target)]
        for phase_id in affected:
            state["phases"][phase_id].update({
                "status": "not_started",
                "result_ref": None,
                "outcome_kind": None,
                "evidence_refs": [],
                "acceptance": None,
            })
        if (
            not withdrawal_route
            and previous_current in phases
            and PHASE_IDS.index(previous_current) < PHASE_IDS.index(target)
        ):
            state["current_phase_id"] = previous_current
            state["phases"][previous_current]["status"] = "active"
        else:
            next_current = next((phase for phase in phases if PHASE_IDS.index(phase) >= PHASE_IDS.index(target)), None)
            state["current_phase_id"] = next_current
            if next_current is not None:
                state["phases"][next_current]["status"] = "active"
                state["phases"][next_current]["input_revision"] = state["input_revision"]
        for phase_id, phase_record in state["phases"].items():
            if phase_id not in old_phases:
                phase_record["input_revision"] = state["input_revision"]
        state["skip_records"] = {
            phase_id: {**skip, "task_route_revision": state["task_route_revision"]}
            for phase_id, skip in state["skip_records"].items()
            if phase_id in phases and state["phases"][phase_id].get("status") == "skipped"
        }
        for phase_id in omitted:
            state["skip_records"][phase_id] = {"reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
        if withdrawal_route and state["phases"][PHASE_IDS[0]].get("status") != "accepted":
            state["phases"][PHASE_IDS[0]].update({
                "status": "skipped",
                "result_ref": None,
                "outcome_kind": None,
                "reason": reason,
                "evidence_refs": evidence,
                "acceptance": None,
            })
            state["skip_records"][PHASE_IDS[0]] = {
                "reason": reason,
                "evidence_refs": evidence,
                "task_route_revision": state["task_route_revision"],
            }
        state["implementation_authorization"] = None
        state["closeout_disposition"] = None
        state["route_dependency_admission"] = None
        state["return_record"] = {
            "from": current,
            "to": target,
            "reason": reason,
            "evidence_refs": evidence,
            "task_route_revision": state["task_route_revision"],
        }
    elif action == "authorize":
        if current not in {PHASE_IDS[2], PHASE_IDS[3]}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "implementation authorization is recorded at the Task Implementation and Test Verification Phase entry")
        contract_ref = _required_text(args.contract_ref, "--contract-ref")
        approval_ref = _required_text(args.approval_ref, "--approval-ref")
        design = state["phases"].get(PHASE_IDS[2])
        if PHASE_IDS[2] in state["phase_ids"]:
            if not isinstance(design, dict) or design.get("status") != "accepted" or design.get("outcome_kind") != "implementation_contract" or design.get("result_ref") != contract_ref:
                raise TaskWorkflowError("TASK_PHASE_CONTRACT_NOT_ACCEPTED", "authorize the accepted implementation contract from Solution Design and Convergence Phase")
            artifact_refs = design.get("artifact_refs")
            if not isinstance(artifact_refs, list) or any(not isinstance(ref, str) for ref in artifact_refs):
                raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "accepted Solution Design and Convergence Phase artifact references are invalid")
            if _artifact_digest(task_dir, artifact_refs) != design.get("artifact_revision"):
                raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "Solution Design and Convergence Phase implementation contract changed after acceptance; refresh and accept the current artifact before authorization")
        elif contract_ref not in state.get("skip_records", {}).get(PHASE_IDS[2], {}).get("evidence_refs", []):
            raise TaskWorkflowError("TASK_PHASE_CONTRACT_NOT_ACCEPTED", "when Solution Design and Convergence Phase is omitted, the implementation contract must be among its route evidence")
        _require_acceptance_coverage(task_dir, contract_ref)
        state["implementation_authorization"] = {"contract_ref": contract_ref, "contract_revision": _artifact_digest(task_dir, [contract_ref]), "approval_ref": approval_ref, "task_route_revision": state["task_route_revision"]}
        if current == PHASE_IDS[2]:
            _advance(state, current)
    else:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ACTION", f"unknown phase action: {action}")

    _save(task_dir / FILE_TASK_JSON, data)
    print(json.dumps(state, ensure_ascii=False))
    return 0


def cmd_phase(args: argparse.Namespace) -> int:
    try:
        task_dir = _task_dir(args.task_dir)
        with _task_lock(task_dir):
            data, meta = _load(task_dir, initialize_meta=args.phase_action == "init")
            if args.phase_action == "init":
                return _init(args, task_dir, data, meta)
            return _update(args, task_dir, data, _state(meta))
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1


DELEGATION_DEPENDENCIES = {"pennix-lifecycle", "paseo", "git"}


def _git_output(args: list[str], cwd: Path) -> str:
    code, output, error = run_git(args, cwd=cwd)
    if code != 0:
        raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", error.strip() or "Git validation failed")
    return output.strip()


def _paseo_json(args: list[str], cwd: Path, code: str) -> dict | list:
    try:
        result = subprocess.run(
            ["paseo", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8"
        )
    except OSError as error:
        raise TaskWorkflowError(code, f"could not run Paseo: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise TaskWorkflowError(code, detail or f"Paseo exited with status {result.returncode}")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise TaskWorkflowError(code, "Paseo did not return valid JSON") from error
    if not isinstance(value, (dict, list)):
        raise TaskWorkflowError(code, "Paseo returned an invalid response")
    return value


def _paseo_list(args: list[str], cwd: Path, code: str) -> list[dict]:
    value = _paseo_json(args, cwd, code)
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise TaskWorkflowError(code, "Paseo returned an invalid list response")
    return value


def _delegation_binding(repo_root: Path, child_dir: Path, child_data: dict, result_path: str) -> dict:
    if not isinstance(result_path, str) or Path(result_path).is_absolute() or ".." in Path(result_path).parts or not result_path.startswith(".trellis/delegated-results/"):
        raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_INVALID", "result path must stay under .trellis/delegated-results/")
    try:
        contract_path = (child_dir / "prd.md").resolve(strict=True)
        contract_path.relative_to(child_dir.resolve())
        role_path = (repo_root / ".trellis/agents/delegated-worktree-primary-agent.md").resolve(strict=True)
        role_path.relative_to((repo_root / ".trellis/agents").resolve())
        if not contract_path.is_file() or not role_path.is_file() or contract_path.stat().st_size + role_path.stat().st_size > 1048576:
            raise ValueError("delegated contract and role must be regular files within the size budget")
        contract = contract_path.read_bytes()
        role = role_path.read_bytes()
    except (OSError, ValueError) as error:
        raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_INVALID", str(error)) from error
    if not contract.strip() or not role.strip():
        raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_INVALID", "child PRD and delegated role must be nonempty")
    return {
        "contract_sha256": hashlib.sha256(contract).hexdigest(),
        "role_sha256": hashlib.sha256(role).hexdigest(),
        "branch": _required_text(child_data.get("branch"), "child branch"),
        "base_commit": _git_output(["rev-parse", "--verify", "--end-of-options", f"{_required_text(child_data.get('base_branch'), 'child base_branch')}^{{commit}}"], repo_root),
        "result_path": result_path,
    }


def cmd_delegate_bind(args: argparse.Namespace) -> int:
    try:
        repo_root = get_repo_root().resolve()
        child_dir = _task_dir(args.child_task)
        child, _ = _load(child_dir)
        if not isinstance(child.get("parent"), str) or not child["parent"].strip():
            raise TaskWorkflowError("TASK_DELEGATE_PARENT_LINK_INVALID", "child task has no parent link")
        parent_dir = _task_dir(child["parent"])
        parent, meta = _load(parent_dir)
        if child_dir.name not in parent.get("children", []) or not implementation_start_ready(parent, parent_dir):
            raise TaskWorkflowError("TASK_DELEGATE_IMPLEMENTATION_NOT_AUTHORIZED", "bind only a linked child within current parent implementation authorization")
        state = _state(meta)
        authorization = state["implementation_authorization"]
        result_path = args.result_path or f".trellis/delegated-results/{child_dir.name}.md"
        binding = _delegation_binding(repo_root, child_dir, child, result_path)
        binding.update({"authorization_ref": authorization["approval_ref"], "parent_contract_revision": authorization["contract_revision"], "task_route_revision": state["task_route_revision"]})
        meta.setdefault("delegation_authorizations", {})[child_dir.name] = binding
        _save(parent_dir / FILE_TASK_JSON, parent)
        print(json.dumps(binding, ensure_ascii=False))
        return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1


def cmd_delegate_start(args: argparse.Namespace) -> int:
    try:
        repo_root = get_repo_root().resolve()
        child_dir = _task_dir(args.child_task)
        child_data, _ = _load(child_dir)
        parent_ref = child_data.get("parent")
        if not isinstance(parent_ref, str) or not parent_ref.strip():
            raise TaskWorkflowError("TASK_DELEGATE_PARENT_LINK_INVALID", "child task has no parent link")
        parent_dir = _task_dir(parent_ref)
        lock_dirs = sorted((parent_dir, child_dir), key=str)
        with _task_lock(lock_dirs[0]), _task_lock(lock_dirs[1]):
            parent_data, parent_meta = _load(parent_dir)
            child_data, child_meta = _load(child_dir)
            if child_data.get("parent") != parent_dir.name or child_dir.name not in parent_data.get("children", []):
                raise TaskWorkflowError("TASK_DELEGATE_PARENT_LINK_INVALID", "parent and child task links do not match")
            from .task_continuity import assert_task_mutation_allowed

            assert_task_mutation_allowed(repo_root, parent_dir, parent_data)
            if child_data.get("status") not in {"planning", "in_progress"}:
                raise TaskWorkflowError("TASK_DELEGATE_CHILD_TERMINAL", "only a planning or in-progress child task can be delegated")
            if parent_data.get("status") != "in_progress" or not implementation_start_ready(parent_data, parent_dir):
                raise TaskWorkflowError("TASK_DELEGATE_IMPLEMENTATION_NOT_AUTHORIZED", "parent task is not at an authorized Task Implementation and Test Verification Phase entry")

            state = _state(parent_meta)
            admission = state.get("route_dependency_admission")
            if not isinstance(admission, dict):
                raise TaskWorkflowError("TASK_DELEGATE_ADMISSION_REQUIRED", "parent task has no current route dependency admission")
            dependencies = admission.get("dependencies", [])
            if (
                admission.get("admission_state") != "ready"
                or admission.get("task_route_revision") != state.get("task_route_revision")
                or not DELEGATION_DEPENDENCIES.issubset(set(dependencies))
                or not admission.get("evidence_refs")
            ):
                raise TaskWorkflowError("TASK_DELEGATE_ADMISSION_REQUIRED", "route dependency admission must be current, ready, evidenced, and include Pennix Lifecycle, Paseo, and Git")

            contract_path = child_dir / "prd.md"
            try:
                resolved_contract = contract_path.resolve(strict=True)
                resolved_contract.relative_to(child_dir.resolve())
                contract_bytes = resolved_contract.read_bytes()
                contract = contract_bytes.decode("utf-8")
            except (OSError, UnicodeError, ValueError) as error:
                raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_INVALID", f"child task prd.md is unavailable: {error}") from error
            if not contract.strip():
                raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_INVALID", "child task prd.md is empty")

            branch_value = child_data.get("branch")
            base_value = child_data.get("base_branch")
            if not isinstance(branch_value, str) or not isinstance(base_value, str):
                raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", "child task branch and base_branch must be set")
            branch = _required_text(branch_value, "child task branch")
            base_branch = _required_text(base_value, "child task base_branch")
            if branch == base_branch:
                raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", "child task branch and base_branch must differ")
            _git_output(["check-ref-format", "--branch", branch], repo_root)
            _git_output(["check-ref-format", "--branch", base_branch], repo_root)
            top_level = Path(_git_output(["rev-parse", "--show-toplevel"], repo_root)).resolve()
            if top_level != repo_root:
                raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", "Trellis repository root does not match the Git checkout")
            base_commit = _git_output(["rev-parse", "--verify", "--end-of-options", f"{base_branch}^{{commit}}"], repo_root)
            branch_exists, _, _ = run_git(["show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=repo_root)
            if branch_exists not in {0, 1}:
                raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", "could not check whether the child task branch already exists")

            if shutil.which("paseo") is None:
                raise TaskWorkflowError("TASK_DELEGATE_PASEO_UNAVAILABLE", "Paseo CLI is not available on PATH")
            try:
                version = subprocess.run(["paseo", "--version"], cwd=repo_root, capture_output=True, text=True, encoding="utf-8")
            except OSError as error:
                raise TaskWorkflowError("TASK_DELEGATE_PASEO_UNAVAILABLE", f"could not run Paseo: {error}") from error
            if version.returncode != 0:
                raise TaskWorkflowError("TASK_DELEGATE_PASEO_UNAVAILABLE", (version.stderr or version.stdout).strip() or "Paseo CLI preflight failed")
            _paseo_list(["agent", "ls", "--all", "--global", "--background", "--json"], repo_root, "TASK_DELEGATE_PASEO_UNAVAILABLE")
            role_path = repo_root / ".trellis" / "agents" / "delegated-worktree-primary-agent.md"
            try:
                role = role_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                raise TaskWorkflowError("TASK_DELEGATE_ROLE_MISSING", f"delegated worktree role is unavailable: {error}") from error

            authorization = state.get("implementation_authorization")
            if not isinstance(authorization, dict) or not isinstance(authorization.get("approval_ref"), str):
                raise TaskWorkflowError("TASK_DELEGATE_AUTHORIZATION_INVALID", "current implementation authorization is invalid")
            contract_digest = hashlib.sha256(contract_bytes).hexdigest()
            bindings = parent_meta.get("delegation_authorizations", {})
            binding = bindings.get(child_dir.name) if isinstance(bindings, dict) else None
            if not isinstance(binding, dict):
                raise TaskWorkflowError("TASK_DELEGATE_CONTRACT_NOT_BOUND", "freeze this child through delegate-bind before dispatch")
            actual = _delegation_binding(repo_root, child_dir, child_data, binding.get("result_path", ""))
            if any(binding.get(key) != value for key, value in actual.items()) or actual["contract_sha256"] != contract_digest or actual["role_sha256"] != hashlib.sha256(role.encode("utf-8")).hexdigest() or binding.get("authorization_ref") != authorization["approval_ref"] or binding.get("parent_contract_revision") != authorization["contract_revision"] or binding.get("task_route_revision") != state["task_route_revision"]:
                raise TaskWorkflowError("TASK_DELEGATE_STALE_CONTRACT", "child PRD, role, Git base, output path, or parent authorization changed; review and bind the child again")
            prompt_bytes = len((role + contract).encode("utf-8"))
            if prompt_bytes > (24000 if os.name == "nt" else 96000):
                raise TaskWorkflowError("TASK_DELEGATE_PROMPT_TOO_LARGE", "delegated prompt exceeds the native Paseo argv budget; narrow the contract before creating resources")
            previous = child_meta.get("delegated_worktree_execution_record")
            reuse_workspace = False
            workspace_id = None
            worktree = None
            if previous is not None:
                if not isinstance(previous, dict):
                    raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "existing execution mapping is invalid; reconcile it before starting another run")
                if previous.get("authorization_ref") == authorization["approval_ref"]:
                    raise TaskWorkflowError("TASK_DELEGATE_REAUTHORIZATION_REQUIRED", "reconcile the prior execution and record fresh implementation authorization before retrying")
                if (
                    previous.get("parent_task_id") != parent_dir.name
                    or previous.get("parent_task_route_revision") != state["task_route_revision"]
                    or previous.get("implementation_contract_sha256") != contract_digest
                    or previous.get("branch") != branch
                ):
                    raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the prior execution belongs to a different route, contract, or branch; create a newly authorized child task")
                previous_workspace_id = previous.get("workspace_id")
                previous_worktree_path = previous.get("worktree_path")
                if not isinstance(previous_workspace_id, str) or not previous_workspace_id.strip() or not isinstance(previous_worktree_path, str) or not previous_worktree_path.strip():
                    raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the prior execution mapping is incomplete; reconcile the Paseo workspace and worktree before retrying")
                previous_worktree = Path(previous_worktree_path).expanduser().resolve()
                agents = _paseo_list([
                    "agent", "ls", "--all", "--global", "--background", "--json",
                    "--label", f"trellis.task_id={previous.get('label_task_id', child_dir.name)}",
                ], repo_root, "TASK_DELEGATE_RECONCILIATION_REQUIRED")
                for agent in agents:
                    agent_id = agent.get("id")
                    if agent.get("status") != "closed":
                        raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "a Paseo agent for this child task is not confirmed closed")
                    if agent_id == previous.get("agent_id"):
                        agent_cwd = agent.get("cwd")
                        if not isinstance(agent_cwd, str) or Path(agent_cwd).expanduser().resolve() != previous_worktree:
                            raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the recorded Paseo agent does not match the mapped worktree")
                if previous.get("agent_id") and not any(agent.get("id") == previous.get("agent_id") for agent in agents):
                    raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the recorded Paseo agent is not present for reconciliation")
                workspaces = _paseo_list(["workspace", "ls", "--background", "--json"], repo_root, "TASK_DELEGATE_RECONCILIATION_REQUIRED")
                workspace_row = next((item for item in workspaces if item.get("workspaceId") == previous_workspace_id), None)
                if workspace_row is not None:
                    workspace_cwd = workspace_row.get("cwd")
                    if not isinstance(workspace_cwd, str) or Path(workspace_cwd).expanduser().resolve() != previous_worktree or not previous_worktree.is_dir():
                        raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the recorded Paseo workspace does not match its existing worktree")
                    worktree = previous_worktree
                    worktree_root = Path(_git_output(["rev-parse", "--show-toplevel"], worktree)).resolve()
                    common_dir = Path(_git_output(["rev-parse", "--git-common-dir"], repo_root))
                    worktree_common_dir = Path(_git_output(["rev-parse", "--git-common-dir"], worktree))
                    common_dir = (common_dir if common_dir.is_absolute() else repo_root / common_dir).resolve()
                    worktree_common_dir = (worktree_common_dir if worktree_common_dir.is_absolute() else worktree / worktree_common_dir).resolve()
                    if (
                        worktree_root != worktree
                        or worktree_common_dir != common_dir
                        or _git_output(["branch", "--show-current"], worktree) != branch
                        or _git_output(["rev-parse", "HEAD"], worktree) != base_commit
                        or _git_output(["status", "--porcelain", "--untracked-files=all"], worktree)
                    ):
                        raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the prior worktree is not clean at the authorized branch and Git base; preserve and reconcile it before retrying")
                    workspace_id = previous_workspace_id
                    reuse_workspace = True
                else:
                    if previous_worktree.exists() or branch_exists == 0:
                        raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "the prior workspace is unavailable but its worktree or branch remains; reconcile it before rebuilding")
            elif branch_exists == 0:
                raise TaskWorkflowError("TASK_DELEGATE_GIT_INVALID", f"child task branch already exists: {branch}")

            record = {
                "parent_task_id": parent_dir.name,
                "parent_task_route_revision": state["task_route_revision"],
                "authorization_ref": authorization["approval_ref"],
                "implementation_contract_ref": "prd.md",
                "implementation_contract_sha256": contract_digest,
                "branch": branch,
                "base_commit": base_commit,
                "workspace_id": workspace_id,
                "worktree_path": str(worktree) if worktree else None,
                "agent_id": None,
                "label_task_id": child_dir.name,
                "role_sha256": actual["role_sha256"],
                "result_path": actual["result_path"],
                "status": "starting",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
            if previous is not None:
                child_meta.setdefault("delegated_worktree_execution_history", []).append(previous)
            child_meta["delegated_worktree_execution_record"] = record
            _save(child_dir / FILE_TASK_JSON, child_data)

            try:
                if not reuse_workspace:
                    workspace = _paseo_json([
                        "workspace", "create", "--isolation", "worktree", "--path", str(repo_root),
                        "--mode", "branch-off", "--worktree-slug", child_dir.name,
                        "--new-branch", branch, "--base", base_commit,
                        "--title", child_data.get("title") or child_dir.name, "--json",
                    ], repo_root, "TASK_DELEGATE_WORKSPACE_FAILED")
                    if not isinstance(workspace, dict):
                        raise TaskWorkflowError("TASK_DELEGATE_WORKSPACE_FAILED", "Paseo returned an invalid workspace response")
                    workspace_id = workspace.get("workspaceId")
                    worktree_path = workspace.get("cwd")
                    if not isinstance(workspace_id, str) or not workspace_id.strip() or not isinstance(worktree_path, str) or not worktree_path.strip():
                        raise TaskWorkflowError("TASK_DELEGATE_WORKSPACE_FAILED", "Paseo workspace response lacks workspaceId or cwd")
                    worktree = Path(worktree_path).expanduser()
                    if not worktree.is_absolute():
                        worktree = repo_root / worktree
                    worktree = worktree.resolve()
                    record.update({"workspace_id": workspace_id, "worktree_path": str(worktree), "status": "workspace_created"})
                    _save(child_dir / FILE_TASK_JSON, child_data)
                if not isinstance(worktree, Path) or not isinstance(workspace_id, str):
                    raise TaskWorkflowError("TASK_DELEGATE_WORKSPACE_FAILED", "Paseo workspace mapping is incomplete")
                worktree_root = Path(_git_output(["rev-parse", "--show-toplevel"], worktree)).resolve()
                common_dir = Path(_git_output(["rev-parse", "--git-common-dir"], repo_root))
                worktree_common_dir = Path(_git_output(["rev-parse", "--git-common-dir"], worktree))
                common_dir = (common_dir if common_dir.is_absolute() else repo_root / common_dir).resolve()
                worktree_common_dir = (worktree_common_dir if worktree_common_dir.is_absolute() else worktree / worktree_common_dir).resolve()
                if worktree_root != worktree or worktree_common_dir != common_dir:
                    raise TaskWorkflowError("TASK_DELEGATE_WORKSPACE_FAILED", "Paseo workspace is not a worktree of the task repository")
                if _git_output(["branch", "--show-current"], worktree) != branch or _git_output(["rev-parse", "HEAD"], worktree) != base_commit:
                    raise TaskWorkflowError("TASK_DELEGATE_WORKSPACE_FAILED", "Paseo worktree branch or base does not match the child task")

                prompt = (
                    "Follow the delegated worktree role below. The child task's prd.md is the sole task-specific implementation contract; "
                    "the parent authorization and Git baseline are execution metadata. Do not accept task phases or change task lifecycle state.\n\n"
                    f"Parent task: {parent_dir.name}\nParent route revision: {state['task_route_revision']}\n"
                    f"Authorized contract: prd.md\nBranch: {branch}\nBase commit: {base_commit}\n\n"
                    f"Assigned result artifact: {actual['result_path']}\n"
                    f"{role}\n\n## Child task prd.md\n{contract}"
                )
                agent = _paseo_json([
                    "run", "--workspace", workspace_id, "--no-wait", "--json",
                    "--title", child_data.get("title") or child_dir.name,
                    "--label", f"trellis.task_id={child_dir.name}",
                    "--label", f"trellis.parent_task_id={parent_dir.name}", prompt,
                ], repo_root, "TASK_DELEGATE_AGENT_START_FAILED")
                if not isinstance(agent, dict):
                    raise TaskWorkflowError("TASK_DELEGATE_AGENT_START_FAILED", "Paseo returned an invalid agent response")
                agent_id = agent.get("agentId")
                if not isinstance(agent_id, str) or not agent_id.strip():
                    raise TaskWorkflowError("TASK_DELEGATE_AGENT_START_FAILED", "Paseo run response lacks agentId")
                record.update({"agent_id": agent_id, "status": "running"})
                _save(child_dir / FILE_TASK_JSON, child_data)
            except TaskWorkflowError as error:
                record["status"] = "reconciliation_required"
                record["last_error"] = {"code": error.code, "reason": str(error)}
                _save(child_dir / FILE_TASK_JSON, child_data)
                raise

            print(json.dumps(record, ensure_ascii=False))
            return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1

def cmd_cancel_task(args: argparse.Namespace) -> int:
    try:
        task_dir = _task_dir(args.task_dir)
        with _task_lock(task_dir):
            data, meta = _load(task_dir)
            if data.get("status") in {"completed", "cancelled"}:
                raise TaskWorkflowError("TASK_PHASE_TASK_TERMINAL", f"task is already {data['status']}")
            readiness_error = task_closeout_readiness(data, "cancelled")
            if readiness_error:
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", readiness_error)
            _require_current_accepted_artifacts(task_dir, _state(meta))
            _validate_child_dispositions(task_dir, data, "cancelled", None, from_acceptance=True)
            _assert_delegated_resources_closed(task_dir, data)
            meta["task_cancellation"] = {
                "reason": _required_text(args.reason, "--reason"),
                "evidence_refs": _refs(args.evidence_ref, "--evidence-ref", required=True),
            }
            data["status"] = "cancelled"
            data["completedAt"] = None
            from .task_move import relocate_task
            task_dir = relocate_task(get_repo_root(), task_dir, data)
            from .active_task import clear_task_from_sessions
            from .task_continuity import clear_task_runtime_records

            repo_root = get_repo_root()
            clear_task_from_sessions(str(task_dir), repo_root)
            records_cleared = clear_task_runtime_records(repo_root, task_dir.relative_to(repo_root).as_posix())
            print(json.dumps({"status": data["status"], "task_cancellation": meta["task_cancellation"], "runtime_records_cleared": records_cleared}, ensure_ascii=False))
            return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1


def cmd_reopen_task(args: argparse.Namespace) -> int:
    try:
        task_dir = _task_dir(args.task_dir)
        with _task_lock(task_dir):
            data, meta = _load(task_dir)
            previous_status = data.get("status")
            if previous_status not in {"completed", "cancelled"}:
                raise TaskWorkflowError("TASK_PHASE_REOPEN_INVALID_STATUS", "only completed or cancelled tasks can be reopened")
            reason = _required_text(args.reason, "--reason")
            evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
            _assert_delegated_resources_closed(task_dir, data)
            recoveries = meta.setdefault("task_lifecycle_recoveries", [])
            if not isinstance(recoveries, list) or any(not isinstance(record, dict) for record in recoveries):
                raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task lifecycle recovery history is malformed")
            recovery = {
                "from_status": previous_status,
                "to_status": "planning",
                "reason": reason,
                "evidence_refs": evidence,
                "reopened_at": datetime.now(timezone.utc).isoformat(),
                "terminal_completed_at": data.get("completedAt"),
                "terminal_cancellation": copy.deepcopy(meta.get("task_cancellation")),
            }
            state = meta.get("task_workflow")
            if state is not None:
                state = _state(meta)
                state["implementation_authorization"] = None
                state["route_dependency_admission"] = None
                state["closeout_disposition"] = None
            recoveries.append(recovery)
            data["status"] = "planning"
            data["completedAt"] = None
            from .task_move import relocate_task
            from .active_task import clear_task_from_sessions
            from .task_continuity import clear_task_runtime_records

            repo_root = get_repo_root()
            # Relocation rewrites runtime paths; terminal runtime must be discarded first.
            for runtime_dir in (task_dir, repo_root / ".trellis/tasks/planning" / task_dir.name):
                clear_task_from_sessions(str(runtime_dir), repo_root)
                if not clear_task_runtime_records(repo_root, runtime_dir.relative_to(repo_root).as_posix()):
                    raise TaskWorkflowError("TASK_PHASE_RUNTIME_CLEANUP_FAILED", "could not discard terminal task runtime; task remains terminal")
            task_dir = relocate_task(repo_root, task_dir, data)
            print(json.dumps({"status": "planning", "task_lifecycle_recovery": recovery, "runtime_records_cleared": True}, ensure_ascii=False))
            return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1


def task_closeout_readiness(data: dict, disposition: str) -> str | None:
    if "meta" in data and not isinstance(data["meta"], dict):
        return "task metadata is malformed"
    meta = data.get("meta")
    if not isinstance(meta, dict) or "task_workflow" not in meta:
        return "task phase workflow is not initialized"
    state = meta["task_workflow"]
    if not isinstance(state, dict) or not isinstance(state.get("phase_ids"), list) or not isinstance(state.get("phases"), dict):
        return "task phase workflow data is malformed"
    if state.get("current_phase_id") is not None:
        return "the current task phase route is not complete"
    for phase_id in state["phase_ids"]:
        phase = state["phases"].get(phase_id)
        if not isinstance(phase, dict) or phase.get("status") not in {"accepted", "skipped"}:
            return f"task phase {phase_id} is not accepted or skipped"
    closeout = state["phases"].get(PHASE_IDS[4]) if PHASE_IDS[4] in state["phase_ids"] else None
    if not closeout or closeout.get("status") != "accepted":
        return "Delivery Review and On-Site Closeout Phase must be accepted before ending the task"
    if state.get("closeout_disposition") != disposition:
        return f"Delivery Review and On-Site Closeout Phase disposition is {state.get('closeout_disposition')}; expected {disposition}"
    if disposition == "cancelled":
        if not _is_withdrawal_route(state):
            return "cancellation requires a user-confirmed route to Delivery Review and On-Site Closeout Phase"
    return None


def _validate_child_dispositions(
    task_dir: Path,
    data: dict,
    disposition: str,
    requested: list[str] | None,
    *,
    from_acceptance: bool = False,
) -> dict[str, str]:
    children = data.get("children", [])
    if not isinstance(children, list) or any(not isinstance(child, str) or not child.strip() for child in children):
        raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "linked child task list is malformed")
    state = data.get("meta", {}).get("task_workflow", {})
    closeout = state.get("phases", {}).get(PHASE_IDS[4], {})
    acceptance = closeout.get("acceptance") if isinstance(closeout, dict) else None
    if from_acceptance:
        choices = acceptance.get("child_dispositions") if isinstance(acceptance, dict) else None
        if children and not isinstance(choices, dict):
            raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "closeout must record a disposition for every linked child task")
        choices = choices or {}
    else:
        choices = {}
        for item in requested or []:
            child_id, separator, choice = item.partition("=")
            child_id, choice = child_id.strip(), choice.strip()
            if not separator or not child_id or not choice or child_id in choices:
                raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--child-disposition must use unique <task-id>=<choice> values")
            choices[child_id] = choice
        if set(choices) != set(children):
            if children or choices:
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "record exactly one disposition for every linked child task")
    allowed = {"integrated"} if disposition in {"delivery_ready", "no_go"} else {"continue", "independent", "cancelled"}
    if set(choices) != set(children) or any(choice not in allowed for choice in choices.values()):
        raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "child task dispositions do not match the closeout outcome")
    for child_id, choice in choices.items():
        child_dir = _task_dir(child_id)
        child_data, _ = _load(child_dir)
        if child_data.get("parent") != task_dir.name:
            raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", f"child task link is inconsistent: {child_id}")
        if choice == "integrated" and child_data.get("status") != "completed":
            raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", f"child task is not completed and integrated: {child_id}")
        if choice == "cancelled" and child_data.get("status") != "cancelled":
            raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", f"child task must be cancelled through its own flow: {child_id}")
    return choices


def cmd_delegate_reconcile(args: argparse.Namespace) -> int:
    try:
        root = get_repo_root().resolve()
        task_dir = _task_dir(args.child_task)
        data, meta = _load(task_dir)
        record = meta.get("delegated_worktree_execution_record")
        if not isinstance(record, dict):
            raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "no valid delegated execution mapping")
        if record.get("status") == "retired" and isinstance(record.get("closure_evidence"), dict):
            print(json.dumps(record, ensure_ascii=False))
            return 0
        label = record.get("label_task_id", task_dir.name)
        agents = _paseo_list(["agent", "ls", "--all", "--global", "--background", "--json", "--label", f"trellis.task_id={label}"], root, "TASK_DELEGATE_RECONCILIATION_REQUIRED")
        if any(agent.get("status") != "closed" for agent in agents):
            raise TaskWorkflowError("TASK_PHASE_RESOURCE_ACTIVE", "a delegated Paseo agent is still active or unknown")
        agent_id = record.get("agent_id")
        if agent_id and not any(agent.get("id") == agent_id for agent in agents):
            raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "recorded agent is not available; preserve its mapping until native closure evidence is available")
        worktree_path = record.get("worktree_path")
        workspace_id = record.get("workspace_id")
        workspaces = _paseo_list(["workspace", "ls", "--background", "--json"], root, "TASK_DELEGATE_RECONCILIATION_REQUIRED")
        workspace = next((row for row in workspaces if row.get("workspaceId") == workspace_id), None) if workspace_id else None
        if workspace and (not isinstance(worktree_path, str) or Path(workspace.get("cwd", "")).resolve() != Path(worktree_path).resolve()):
            raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "workspace mapping does not match")
        head = None
        if isinstance(worktree_path, str) and Path(worktree_path).is_dir():
            worktree = Path(worktree_path).resolve()
            common = Path(_git_output(["rev-parse", "--git-common-dir"], worktree))
            common = (common if common.is_absolute() else worktree / common).resolve()
            expected_common = Path(_git_output(["rev-parse", "--git-common-dir"], root))
            expected_common = (expected_common if expected_common.is_absolute() else root / expected_common).resolve()
            if common != expected_common or _git_output(["branch", "--show-current"], worktree) != record.get("branch"):
                raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "worktree does not belong to the recorded repository and branch")
            dirty = _git_output(["status", "--porcelain", "--untracked-files=all"], worktree)
            allowed = "?? " + record.get("result_path", "")
            if any(line != allowed for line in dirty.splitlines()):
                raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "worktree contains unintegrated changes; preserve and integrate them before retiring")
            head = _git_output(["rev-parse", "HEAD"], worktree)
            if run_git(["merge-base", "--is-ancestor", head, "HEAD"], cwd=root)[0] != 0:
                raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "worktree commits are not integrated into the coordinator checkout")
        elif workspace:
            raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "workspace still exists but its worktree cannot be inspected")
        elif not agent_id:
            branch = record.get("branch")
            if not isinstance(branch, str) or run_git(["show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=root)[0] != 1:
                raise TaskWorkflowError("TASK_DELEGATE_RECONCILIATION_REQUIRED", "incomplete mapping still has an unresolved branch")
        evidence = {"agent_ids": [agent.get("id") for agent in agents], "workspace_id": workspace_id, "head": head, "checked_at": datetime.now(timezone.utc).isoformat()}
        if not args.execute:
            print(json.dumps({"status": "ready", "evidence": evidence}, ensure_ascii=False))
            return 0
        reason = _required_text(args.reason, "--reason")
        approval_ref = _required_text(args.approval_ref, "--approval-ref")
        record.update({"status": "retired", "closure_evidence": {**evidence, "reason": reason, "approval_ref": approval_ref}})
        _save(task_dir / FILE_TASK_JSON, data)
        print(json.dumps(record, ensure_ascii=False))
        return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1


def _assert_delegated_resources_closed(task_dir: Path, data: dict) -> None:
    children = data.get("children", [])
    if not isinstance(children, list):
        raise TaskWorkflowError("TASK_PHASE_RESOURCE_ACTIVE", "linked child task list is malformed")
    for task_id in [task_dir.name, *children]:
        _, child_meta = _load(_task_dir(task_id))
        _assert_delegated_record_closed(task_id, child_meta.get("delegated_worktree_execution_record"))


def _assert_delegated_record_closed(task_id: str, record) -> None:
    if record is None:
        return
    if isinstance(record, dict) and record.get("status") == "retired" and isinstance(record.get("closure_evidence"), dict):
        return
    agent_id = record.get("agent_id") if isinstance(record, dict) else None
    if not isinstance(agent_id, str) or not agent_id.strip():
        raise TaskWorkflowError("TASK_PHASE_RESOURCE_ACTIVE", f"delegated execution status is unknown for {task_id}; preserve the current state")
    agents = _paseo_list(
        ["agent", "ls", "--all", "--global", "--background", "--json", "--label", f"trellis.task_id={record.get('label_task_id', task_id)}"],
        get_repo_root(),
        "TASK_PHASE_RESOURCE_ACTIVE",
    )
    agent = next((item for item in agents if item.get("id") == agent_id), None)
    if agent is None or agent.get("status") != "closed":
        raise TaskWorkflowError("TASK_PHASE_RESOURCE_ACTIVE", f"delegated Paseo agent for {task_id} is not confirmed closed; preserve the current state")
    worktree_path = record.get("worktree_path")
    if isinstance(worktree_path, str) and Path(worktree_path).is_dir():
        if _git_output(["status", "--porcelain", "--untracked-files=all", "--", ".trellis/tasks", ".trellis/.runtime"], Path(worktree_path)):
            raise TaskWorkflowError("TASK_DELEGATE_TASK_FACTS_CHANGED", "delegated worktree changed protected task facts; preserve evidence and exclude those changes before integration")


def cmd_complete_task(args: argparse.Namespace) -> int:
    try:
        task_dir = _task_dir(args.task_dir)
        with _task_lock(task_dir):
            data, meta = _load(task_dir)
            if data.get("status") in {"completed", "cancelled"}:
                raise TaskWorkflowError("TASK_PHASE_TASK_TERMINAL", f"task is already {data['status']}")
            state = _state(meta)
            _require_current_requirements_confirmation(task_dir, state)
            disposition = state.get("closeout_disposition")
            if disposition not in {"delivery_ready", "no_go"}:
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "Delivery Review and On-Site Closeout Phase must accept delivery_ready or no_go before complete")
            _require_current_accepted_artifacts(task_dir, state)
            readiness_error = task_closeout_readiness(data, disposition)
            if readiness_error:
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", readiness_error)
            _validate_child_dispositions(task_dir, data, disposition, None, from_acceptance=True)
            _assert_delegated_resources_closed(task_dir, data)
            implementation = state["phases"].get(PHASE_IDS[3])
            if isinstance(implementation, dict) and implementation.get("status") == "accepted" and data.get("status") != "in_progress":
                raise TaskWorkflowError("TASK_PHASE_IMPLEMENTATION_NOT_STARTED", "implementation tasks must enter in_progress before complete")
            data["status"] = "completed"
            data["completedAt"] = datetime.now().strftime("%Y-%m-%d")
            from .task_move import relocate_task
            task_dir = relocate_task(get_repo_root(), task_dir, data)
            from .active_task import clear_task_from_sessions
            from .task_continuity import clear_task_runtime_records

            repo_root = get_repo_root()
            clear_task_from_sessions(str(task_dir), repo_root)
            records_cleared = clear_task_runtime_records(repo_root, task_dir.relative_to(repo_root).as_posix())
            run_task_hooks("after_complete", task_dir / FILE_TASK_JSON, repo_root)
            print(json.dumps({"status": data["status"], "completedAt": data["completedAt"], "runtime_records_cleared": records_cleared}, ensure_ascii=False))
            return 0
    except TaskWorkflowError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 1
