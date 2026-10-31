"""Trellis task phase state, stored in task.json.meta.task_workflow."""

from __future__ import annotations

import argparse
import contextlib
from datetime import datetime
import hashlib
import json
import os
import re
import sys
from pathlib import Path

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


def _load(task_dir: Path) -> tuple[dict, dict]:
    task_file = task_dir / FILE_TASK_JSON
    data, reason = read_json_checked(task_file)
    if data is None:
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", f"cannot read {task_file}: {reason}")
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
        _validate_route(",".join(state["phase_ids"]), require_requirements_first=False)
    except (TypeError, TaskWorkflowError) as error:
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task phase route is invalid") from error
    if not ROUTE_REVISION.fullmatch(str(state.get("task_route_revision", ""))) or not ROUTE_REVISION.fullmatch(str(state.get("input_revision", ""))):
        raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "task phase revision is invalid")
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
                or not isinstance(acceptance.get("user_confirmation_ref"), str)
                or not acceptance["user_confirmation_ref"].strip()
            ):
                raise TaskWorkflowError("TASK_PHASE_TASK_INVALID", "accepted phase 1 must retain confirmation for its current artifact revision")
    return state


def implementation_start_ready(data: dict) -> bool:
    meta = data.get("meta")
    state = meta.get("task_workflow") if isinstance(meta, dict) else None
    if not isinstance(state, dict) or state.get("current_phase_id") != PHASE_IDS[3]:
        return False
    if state.get("task_kind") not in {"implementation", "combined"}:
        return False
    authorization = state.get("implementation_authorization")
    design = state.get("phases", {}).get(PHASE_IDS[2])
    return (
        isinstance(authorization, dict)
        and authorization.get("task_route_revision") == state.get("task_route_revision")
        and isinstance(design, dict)
        and design.get("status") == "accepted"
        and design.get("outcome_kind") == "implementation_contract"
        and design.get("result_ref") == authorization.get("contract_ref")
    )


def _save(task_file: Path, data: dict) -> None:
    from .task_continuity import assert_task_mutation_allowed

    assert_task_mutation_allowed(get_repo_root(), task_file.parent, data)
    if not write_json(task_file, data):
        raise TaskWorkflowError("TASK_PHASE_WRITE_FAILED", f"could not update {task_file}")


@contextlib.contextmanager
def _task_lock(task_dir: Path):
    lock_file = task_dir / ".task-phase.lock"
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


def _require_current_requirements_confirmation(task_dir: Path, state: dict) -> None:
    if PHASE_IDS[0] not in state["phase_ids"]:
        return
    requirements = state["phases"].get(PHASE_IDS[0], {})
    acceptance = requirements.get("acceptance") if isinstance(requirements, dict) else None
    if (
        not isinstance(acceptance, dict)
        or requirements.get("status") != "accepted"
        or acceptance.get("artifact_revision") != requirements.get("artifact_revision")
        or not isinstance(acceptance.get("user_confirmation_ref"), str)
        or not acceptance["user_confirmation_ref"].strip()
    ):
        raise TaskWorkflowError("TASK_PHASE_USER_CONFIRMATION_REQUIRED", "phase 1 requirements must be accepted with explicit user confirmation before continuing")
    current_revision = _artifact_digest(task_dir, requirements.get("artifact_refs", []))
    if current_revision != requirements["artifact_revision"]:
        raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "phase 1 artifacts changed after user confirmation; return to phase 1 and obtain confirmation for the current revision")


def _next_phase(state: dict, phase_id: str) -> str | None:
    index = state["phase_ids"].index(phase_id)
    return state["phase_ids"][index + 1] if index + 1 < len(state["phase_ids"]) else None


def _advance(state: dict, phase_id: str) -> None:
    following = _next_phase(state, phase_id)
    state["current_phase_id"] = following
    if following is not None:
        state["phases"][following]["status"] = "active"
        state["phases"][following]["input_revision"] = state["input_revision"]


def _invalidate_from(state: dict, first_phase: str, keep_first: bool = False) -> None:
    first_index = PHASE_IDS.index(first_phase)
    for phase_id in state["phase_ids"]:
        if PHASE_IDS.index(phase_id) < first_index:
            continue
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


def _validate_route(value: str | None, require_requirements_first: bool = True) -> list[str]:
    raw = _required_text(value, "--phase-ids")
    phases = raw.split(",")
    if not phases or any(phase not in PHASE_ID_SET for phase in phases):
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--phase-ids must contain declared phase identifiers")
    if len(set(phases)) != len(phases) or phases != [phase for phase in PHASE_IDS if phase in phases]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--phase-ids must be unique and follow the defined phase order")
    if require_requirements_first and phases[0] != PHASE_IDS[0]:
        raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "the requirements alignment phase must remain first")
    return phases


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
    if args.task_kind not in {"analysis", "implementation", "combined"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--task-kind must be analysis, implementation, or combined")
    if args.complexity not in {"simple", "standard", "complex"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--complexity must be simple, standard, or complex")
    if args.project_context not in {"new", "existing"}:
        raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "--project-context must be new or existing")
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


def _update(args: argparse.Namespace, task_dir: Path, data: dict, state: dict) -> int:
    action = args.phase_action
    if action == "show":
        return _show(state)

    if data.get("status") in {"completed", "cancelled"}:
        raise TaskWorkflowError("TASK_PHASE_TASK_TERMINAL", f"task is already {data['status']}")

    _expected_route(state, args.expected_route_revision)
    if action == "route" and state.get("current_phase_id") is None:
        raise TaskWorkflowError("TASK_PHASE_INCOMPLETE", "completed phases cannot be rerouted")
    current, record = _phase(state)
    returning_to_requirements = action == "return" and args.target_phase == PHASE_IDS[0]
    rerouting_to_requirements = action == "route" and args.target_phase == PHASE_IDS[0]
    if current != PHASE_IDS[0] and not returning_to_requirements and not rerouting_to_requirements:
        _require_current_requirements_confirmation(task_dir, state)
    if action not in {"show", "resume", "route", "authorize"} and record.get("status") != "active":
        raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "only the active phase can be changed")

    if action == "artifact":
        refs = _refs(args.artifact_ref, "--artifact-ref")
        revision = _artifact_digest(task_dir, refs)
        if revision != record["artifact_revision"] or refs != record["artifact_refs"]:
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
    elif action == "resume":
        if record["status"] not in {"waiting_user", "blocked"}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "only a waiting or blocked phase can resume")
        record.update({"status": "active", "reason": None, "outcome_kind": None, "evidence_refs": [], "acceptance": None})
    elif action == "skip":
        reason = _required_text(args.reason, "--reason")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        confirmation = args.user_confirmation_ref
        if current == PHASE_IDS[0]:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "requirements alignment always requires minimum alignment and acceptance")
        record.update({"status": "skipped", "reason": reason, "evidence_refs": evidence})
        if confirmation:
            record["acceptance"] = {"artifact_revision": record["artifact_revision"], "result_revision": record["result_revision"], "evidence_refs": evidence, "user_confirmation_ref": confirmation}
        state["skip_records"][current] = {"reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
        _advance(state, current)
    elif action == "accept":
        artifact_revision = _required_text(args.artifact_revision, "--artifact-revision")
        current_revision = _artifact_digest(task_dir, record["artifact_refs"])
        if artifact_revision != record["artifact_revision"] or current_revision != record["artifact_revision"]:
            raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "artifact revision changed; refresh the phase artifact before acceptance")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        result_ref = _required_text(args.result_ref, "--result-ref")
        outcome = _required_text(args.outcome_kind, "--outcome-kind")
        confirmation = args.user_confirmation_ref
        if current == PHASE_IDS[0]:
            if outcome != "accepted":
                raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "phase 1 can advance only with phase_result=accepted")
            if not confirmation or not confirmation.strip():
                raise TaskWorkflowError("TASK_PHASE_USER_CONFIRMATION_REQUIRED", "phase 1 acceptance requires an explicit user confirmation reference")
            confirmation = _required_text(confirmation, "--user-confirmation-ref")
        if current == PHASE_IDS[2] and outcome not in {"implementation_contract", "analysis_conclusion", "no_go"}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "phase 3 must remain active for pending_user_decision or deferred; accept implementation_contract, analysis_conclusion, or no_go")
        if result_ref not in record["artifact_refs"]:
            raise TaskWorkflowError("TASK_PHASE_RESULT_NOT_BOUND", "--result-ref must be included in the current phase artifact refs")
        if current == PHASE_IDS[3]:
            authorization = state.get("implementation_authorization")
            if not isinstance(authorization, dict) or authorization.get("task_route_revision") != state["task_route_revision"]:
                raise TaskWorkflowError("TASK_PHASE_IMPLEMENTATION_NOT_AUTHORIZED", "phase 4 requires a current implementation authorization")
        if current == PHASE_IDS[4]:
            if args.closeout_disposition not in {"delivery_ready", "no_go", "cancelled"}:
                raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "phase 5 requires --closeout-disposition delivery_ready, no_go, or cancelled")
            if outcome != args.closeout_disposition:
                raise TaskWorkflowError("TASK_PHASE_INVALID_INPUT", "phase 5 outcome must match --closeout-disposition")
            if args.closeout_disposition == "cancelled":
                withdrawal = state.get("return_record")
                if not isinstance(withdrawal, dict) or withdrawal.get("to") != PHASE_IDS[4] or not withdrawal.get("user_confirmation_ref"):
                    raise TaskWorkflowError("TASK_PHASE_USER_CONFIRMATION_REQUIRED", "cancellation closeout requires a user-confirmed route to phase 5")
            state["closeout_disposition"] = args.closeout_disposition
        record["result_revision"] = _increment(record["result_revision"], allow_zero=True)
        record.update({"status": "accepted", "result_ref": result_ref, "outcome_kind": outcome, "reason": None, "evidence_refs": evidence})
        record["acceptance"] = {
            "artifact_revision": artifact_revision,
            "result_revision": record["result_revision"],
            "input_revision": record["input_revision"],
            "task_route_revision": state["task_route_revision"],
            "evidence_refs": evidence,
            **({"user_confirmation_ref": confirmation} if confirmation else {}),
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
        if target not in state["phase_ids"] or state["phase_ids"].index(target) >= state["phase_ids"].index(current):
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "return target must be an earlier phase in the current route")
        reason = _required_text(args.reason, "--reason")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        state["input_revision"] = _increment(state["input_revision"])
        _invalidate_from(state, target, keep_first=True)
        state["phases"][target]["input_revision"] = state["input_revision"]
        state["return_record"] = {"from": current, "to": target, "reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
    elif action == "route":
        phases = _validate_route(args.phase_ids, require_requirements_first=False)
        reason = _required_text(args.reason, "--reason")
        target = _required_text(args.target_phase, "--target-phase")
        evidence = _refs(args.evidence_ref, "--evidence-ref", required=True)
        old_ids = state["phase_ids"]
        changed = [phase for phase in PHASE_IDS if (phase in old_ids) != (phase in phases)]
        withdrawal_route = (
            target == PHASE_IDS[4]
            and phases == [PHASE_IDS[4]]
            and bool(args.user_confirmation_ref)
        )
        if not changed and target == current:
            raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "the updated route and target are unchanged")
        earliest_change = min((PHASE_IDS.index(phase) for phase in changed), default=PHASE_IDS.index(target))
        if target not in PHASE_ID_SET or (PHASE_IDS.index(target) > earliest_change and not withdrawal_route):
            raise TaskWorkflowError("TASK_PHASE_INVALID_ROUTE", "--target-phase must cover the earliest affected route change")
        omitted = [phase for phase in PHASE_IDS if phase not in phases]
        old_phases = state["phases"]
        previous_current = state.get("current_phase_id")
        state["task_route_revision"] = _increment(state["task_route_revision"])
        state["input_revision"] = _increment(state["input_revision"])
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
        if previous_current in phases and PHASE_IDS.index(previous_current) < PHASE_IDS.index(target):
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
        state["skip_records"] = {}
        for phase_id in omitted:
            state["skip_records"][phase_id] = {"reason": reason, "evidence_refs": evidence, "task_route_revision": state["task_route_revision"]}
        state["implementation_authorization"] = None
        state["closeout_disposition"] = None
        state["return_record"] = {
            "from": current,
            "to": target,
            "reason": reason,
            "evidence_refs": evidence,
            "task_route_revision": state["task_route_revision"],
            **({"user_confirmation_ref": _required_text(args.user_confirmation_ref, "--user-confirmation-ref")} if withdrawal_route else {}),
        }
    elif action == "authorize":
        if current not in {PHASE_IDS[2], PHASE_IDS[3]}:
            raise TaskWorkflowError("TASK_PHASE_INVALID_TRANSITION", "implementation authorization is recorded at the phase 4 entry")
        contract_ref = _required_text(args.contract_ref, "--contract-ref")
        approval_ref = _required_text(args.approval_ref, "--approval-ref")
        design = state["phases"].get(PHASE_IDS[2])
        if PHASE_IDS[2] in state["phase_ids"]:
            if design.get("status") != "accepted" or design.get("outcome_kind") != "implementation_contract" or design.get("result_ref") != contract_ref:
                raise TaskWorkflowError("TASK_PHASE_CONTRACT_NOT_ACCEPTED", "authorize the accepted implementation contract from phase 3")
        elif contract_ref not in state.get("skip_records", {}).get(PHASE_IDS[2], {}).get("evidence_refs", []):
            raise TaskWorkflowError("TASK_PHASE_CONTRACT_NOT_ACCEPTED", "when phase 3 is omitted, the implementation contract must be among its route evidence")
        state["implementation_authorization"] = {"contract_ref": contract_ref, "approval_ref": approval_ref, "task_route_revision": state["task_route_revision"]}
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
            data, meta = _load(task_dir)
            if args.phase_action == "init":
                return _init(args, task_dir, data, meta)
            return _update(args, task_dir, data, _state(meta))
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
            meta["task_cancellation"] = {
                "reason": _required_text(args.reason, "--reason"),
                "evidence_refs": _refs(args.evidence_ref, "--evidence-ref", required=True),
            }
            data["status"] = "cancelled"
            data["completedAt"] = None
            _save(task_dir / FILE_TASK_JSON, data)
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
        return "phase 5 must be accepted before ending the task"
    if state.get("closeout_disposition") != disposition:
        return f"phase 5 disposition is {state.get('closeout_disposition')}; expected {disposition}"
    if disposition == "cancelled":
        withdrawal = state.get("return_record")
        if not isinstance(withdrawal, dict) or withdrawal.get("to") != PHASE_IDS[4] or not withdrawal.get("user_confirmation_ref"):
            return "cancellation requires a user-confirmed route to phase 5"
    return None


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
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", "phase 5 must accept delivery_ready or no_go before complete")
            closeout = state["phases"][PHASE_IDS[4]]
            if _artifact_digest(task_dir, closeout.get("artifact_refs", [])) != closeout.get("artifact_revision"):
                raise TaskWorkflowError("TASK_PHASE_STALE_ARTIFACT", "phase 5 artifacts changed after acceptance; review the current delivery candidate again")
            readiness_error = task_closeout_readiness(data, disposition)
            if readiness_error:
                raise TaskWorkflowError("TASK_PHASE_CLOSEOUT_REQUIRED", readiness_error)
            if state.get("task_kind") in {"implementation", "combined"} and data.get("status") != "in_progress":
                raise TaskWorkflowError("TASK_PHASE_IMPLEMENTATION_NOT_STARTED", "implementation tasks must enter in_progress before complete")
            data["status"] = "completed"
            data["completedAt"] = datetime.now().strftime("%Y-%m-%d")
            _save(task_dir / FILE_TASK_JSON, data)
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
