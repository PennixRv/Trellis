"""Task-local material plan revisions; chat approval remains coordinator-owned."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any


class PlanningError(ValueError):
    """A planning contract needs correction before a task can start."""


STAGES = {
    "intake",
    "evidence",
    "decision_convergence",
    "solution_formation",
    "solution_review",
    "user_review",
    "plan_closed",
    "direct_ready",
}
REPLAN_STAGES = STAGES - {"plan_closed", "direct_ready"}
DECISIONS_MARKER = "<!-- trellis-decisions:v1 -->"
IMPLEMENTATION_PLAN_MARKER = "<!-- trellis-implementation-plan:v1 -->"
_DECISION_FIELDS = ("id", "status", "question", "evidence", "answer_or_reason", "impact", "reopen_when")
_STEP_FIELDS = ("id", "target", "depends_on", "action", "deliverables", "verification", "risks", "rollback")


def validate_meta_value(key: str, value: str) -> None:
    if key == "planning" or key.startswith("planning."):
        raise PlanningError("meta.planning is reserved; use task.py plan seal/approve")
    choices = {
        "execution_class": {"direct", "planned"},
        "delivery_mode": {"change_bearing", "analysis_only"},
    }
    if key in choices and value not in choices[key]:
        raise PlanningError(f"{key} must be one of: {', '.join(sorted(choices[key]))}")


def classification(data: dict[str, Any]) -> tuple[str, str]:
    meta = data.get("meta", {})
    if not isinstance(meta, dict):
        raise PlanningError("task meta must be an object")
    execution = meta.get("execution_class")
    delivery = meta.get("delivery_mode")
    if execution not in ("direct", "planned") or delivery not in ("change_bearing", "analysis_only"):
        raise PlanningError("classify this task with execution_class=direct|planned and delivery_mode=change_bearing|analysis_only before start")
    return execution, delivery


def planning_record(data: dict[str, Any]) -> dict[str, Any]:
    meta = data.get("meta", {})
    if not isinstance(meta, dict):
        raise PlanningError("task meta must be an object")
    record = meta.get("planning", {})
    if not isinstance(record, dict):
        raise PlanningError("meta.planning must be an object")
    revision = record.get("revision", 1)
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise PlanningError("planning revision must be a positive integer")
    stage = record.get("stage", "intake" if data.get("status") == "planning" else None)
    if stage is not None and (not isinstance(stage, str) or stage not in STAGES):
        raise PlanningError(f"planning stage must be one of: {', '.join(sorted(STAGES))}")
    return {**record, "revision": revision, **({"stage": stage} if stage else {})}


def invalidate_plan(data: dict[str, Any], stage: str | None = None) -> None:
    record = planning_record(data)
    next_record = {"revision": record["revision"] + 1}
    if stage is not None:
        if not isinstance(stage, str) or stage not in REPLAN_STAGES:
            raise PlanningError(f"unknown planning stage: {stage}")
        next_record["stage"] = stage
    data.setdefault("meta", {})["planning"] = next_record


def _marked_json(task_dir: Path, document: str, marker: str) -> dict[str, Any]:
    path = task_dir / document
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
        raise PlanningError(f"{document} must be a bounded regular file")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise PlanningError(f"{document} must be valid UTF-8") from exc
    markers = [index for index, line in enumerate(lines) if line.strip() == marker]
    if len(markers) != 1:
        raise PlanningError(f"{document} must contain exactly one {marker} block")
    start = markers[0] + 1
    if start >= len(lines) or lines[start].strip() != "```json":
        raise PlanningError(f"{marker} must be immediately followed by a JSON fence")
    end = next((index for index in range(start + 1, len(lines)) if lines[index].strip() == "```"), None)
    if end is None:
        raise PlanningError(f"{document} has an unterminated {marker} JSON fence")
    try:
        value = json.loads("\n".join(lines[start + 1:end]))
    except json.JSONDecodeError as exc:
        raise PlanningError(f"{document} {marker} block is invalid JSON: {exc.msg}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise PlanningError(f"{document} {marker} block requires schema_version=1")
    return value


def validate_decisions(task_dir: Path) -> list[dict[str, Any]]:
    value = _marked_json(task_dir, "prd.md", DECISIONS_MARKER)
    decisions = value.get("decisions")
    if not isinstance(decisions, list):
        raise PlanningError("trellis-decisions:v1 requires a decisions array")
    ids: set[str] = set()
    for item in decisions:
        if not isinstance(item, dict) or any(key not in item for key in _DECISION_FIELDS):
            raise PlanningError("each decision requires id, status, question, evidence, answer_or_reason, impact, and reopen_when")
        if any(not isinstance(item[key], str) or not item[key].strip() for key in ("id", "question", "answer_or_reason", "impact", "reopen_when")):
            raise PlanningError("decision text fields must be non-empty strings")
        if item["id"] in ids:
            raise PlanningError(f"duplicate decision id: {item['id']}")
        ids.add(item["id"])
        if not isinstance(item["status"], str) or item["status"] not in {"open", "decided", "deferred", "excluded"}:
            raise PlanningError(f"invalid decision status for {item['id']}")
        evidence = item["evidence"]
        if not isinstance(evidence, list) or not evidence or any(not isinstance(entry, str) or not entry.strip() for entry in evidence):
            raise PlanningError(f"decision evidence must contain non-empty references: {item['id']}")
    return decisions


def validate_implementation_plan(task_dir: Path) -> dict[str, Any]:
    value = _marked_json(task_dir, "implement.md", IMPLEMENTATION_PLAN_MARKER)
    steps = value.get("steps")
    if not isinstance(steps, list) or not steps:
        raise PlanningError("trellis-implementation-plan:v1 requires a non-empty steps array")
    seen: set[str] = set()
    for step in steps:
        if not isinstance(step, dict) or any(key not in step for key in _STEP_FIELDS):
            raise PlanningError("each implementation step requires id, target, depends_on, action, deliverables, verification, risks, and rollback")
        identifier = step["id"]
        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen:
            raise PlanningError(f"implementation step id is empty or duplicated: {identifier!r}")
        target = step["target"]
        if not isinstance(target, dict) or any(not isinstance(target.get(key), str) or not target[key].strip() for key in ("repository", "branch", "component_or_path")):
            raise PlanningError(f"implementation step {identifier} requires repository, branch, and component_or_path")
        for key in ("action", "deliverables", "verification", "risks", "rollback"):
            if not isinstance(step[key], str) or not step[key].strip():
                raise PlanningError(f"implementation step {identifier} requires non-empty {key}")
        dependencies = step["depends_on"]
        if not isinstance(dependencies, list) or any(not isinstance(dep, str) for dep in dependencies):
            raise PlanningError(f"implementation step {identifier} depends_on must be an array of earlier step ids")
        if len(dependencies) != len(set(dependencies)) or any(dep not in seen for dep in dependencies):
            raise PlanningError(f"implementation step {identifier} has duplicate, unknown, or forward dependencies")
        seen.add(identifier)
    stop = value.get("stop_point")
    if not isinstance(stop, dict) or any(not isinstance(stop.get(key), str) or not stop[key].strip() for key in ("condition", "observable_evidence", "remaining_work")):
        raise PlanningError("implementation plan requires one stop_point with condition, observable_evidence, and remaining_work")
    return value


def validate_direct_plan(data: dict[str, Any], task_dir: Path) -> None:
    if not isinstance(data.get("assignee"), str) or not data["assignee"].strip():
        raise PlanningError("direct task requires one named owner in task.json")
    prd = task_dir / "prd.md"
    if prd.is_symlink() or not prd.is_file() or prd.stat().st_size > 256 * 1024:
        raise PlanningError("direct task requires a bounded regular prd.md")
    try:
        content = prd.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise PlanningError("direct task prd.md must be readable UTF-8") from exc
    headings = list(re.finditer(r"(?m)^#{1,6}\s+(.+?)\s*#*\s*$", content))
    sections: dict[str, str] = {}
    for index, heading in enumerate(headings):
        title = re.sub(r"[\W_]+", "", heading.group(1).casefold())
        end = headings[index + 1].start() if index + 1 < len(headings) else len(content)
        sections[title] = content[heading.end():end].strip()
    required = {
        "one bounded change": {"scope", "boundedchange", "范围", "变更范围", "本次变更"},
        "observable verification": {"verification", "验收", "验证", "验证方式"},
        "rollback method": {"rollback", "rollbackplan", "回退", "回滚", "回退方案", "回滚方案"},
    }
    for label, alternatives in required.items():
        if not any(sections.get(title) for title in alternatives):
            raise PlanningError(f"direct task must provide a non-empty {label} section in prd.md")


def plan_digest(data: dict[str, Any], task_dir: Path) -> str:
    execution, delivery = classification(data)
    documents = _plan_documents(task_dir, execution, delivery)
    payload = {
        "task_id": data.get("id") or task_dir.name,
        "task_name": task_dir.name,
        "execution_class": execution,
        "delivery_mode": delivery,
        "documents": {name: (task_dir / name).read_text(encoding="utf-8") for name in documents},
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + sha256(encoded).hexdigest()


def advance_stage(data: dict[str, Any], task_dir: Path, target: str) -> str:
    if data.get("status") != "planning":
        raise PlanningError("planning stages can only advance while status=planning")
    if not isinstance(target, str) or target not in STAGES or target == "plan_closed":
        raise PlanningError(f"invalid planning stage target: {target}")
    execution, delivery = classification(data)
    record = planning_record(data)
    current = record.get("stage", "intake")
    allowed = {
        "intake": {"evidence"},
        "evidence": {"decision_convergence", "solution_formation", "direct_ready"},
        "decision_convergence": {"evidence", "solution_formation"},
        "solution_formation": {"evidence", "decision_convergence", "solution_review"},
        "solution_review": {"evidence", "decision_convergence", "solution_formation", "user_review"},
        "user_review": {"evidence", "decision_convergence", "solution_formation"},
        "plan_closed": set(),
        "direct_ready": set(),
    }
    if current not in allowed or target not in allowed[current]:
        raise PlanningError(f"invalid planning transition: {current} -> {target}")
    decisions: list[dict[str, Any]] | None = None
    if target in {"decision_convergence", "solution_formation", "solution_review", "user_review"} or current == "decision_convergence":
        decisions = validate_decisions(task_dir)
    open_decisions = [item["id"] for item in decisions or [] if item["status"] == "open"]
    if target == "decision_convergence" and (execution != "planned" or delivery != "change_bearing" or not open_decisions):
        raise PlanningError("decision_convergence requires planned change-bearing work with open decisions")
    if target == "solution_formation" and (execution != "planned" or delivery != "change_bearing" or open_decisions):
        raise PlanningError("solution_formation requires planned change-bearing work with no open decisions")
    if target == "solution_review":
        validate_implementation_plan(task_dir)
        if open_decisions:
            raise PlanningError("open decisions block solution review: " + ", ".join(open_decisions))
    if target == "user_review":
        validate_implementation_plan(task_dir)
        if open_decisions:
            raise PlanningError("open decisions block user review: " + ", ".join(open_decisions))
    if target == "direct_ready":
        if execution != "direct" or delivery != "change_bearing":
            raise PlanningError("direct_ready requires direct change-bearing classification")
        validate_direct_plan(data, task_dir)
    if target in {"evidence", "decision_convergence", "solution_formation"} and current in {"solution_review", "user_review"}:
        invalidate_plan(data, target)
    else:
        record["stage"] = target
        data.setdefault("meta", {})["planning"] = record
    return target


def _plan_documents(task_dir: Path, execution: str, delivery: str) -> list[str]:
    names = ["prd.md"]
    if execution == "planned":
        names.append("design.md")
        if delivery == "change_bearing":
            names.append("implement.md")
    for name in names:
        document = task_dir / name
        if document.is_symlink() or not document.is_file():
            raise PlanningError(f"plan requires a regular task document: {name}")
        if document.stat().st_size > 256 * 1024 or not document.read_text(encoding="utf-8").strip():
            raise PlanningError(f"plan document must be bounded, non-empty UTF-8: {name}")
    return names


def seal_plan(data: dict[str, Any], task_dir: Path, expected_digest: str) -> int:
    record = planning_record(data)
    if record.get("stage") != "user_review":
        raise PlanningError("plan seal requires stage=user_review")
    execution, delivery = classification(data)
    documents = _plan_documents(task_dir, execution, delivery)
    decisions = validate_decisions(task_dir)
    if any(item["status"] == "open" for item in decisions):
        raise PlanningError("open decisions prevent plan sealing")
    validate_implementation_plan(task_dir)
    actual_digest = plan_digest(data, task_dir)
    if expected_digest != actual_digest:
        raise PlanningError("displayed plan digest is stale; review the current complete plan again")
    revision = record["revision"] + (1 if record.get("seal") else 0)
    data.setdefault("meta", {})["planning"] = {
        "revision": revision,
        "stage": "user_review",
        "review_digest": actual_digest,
        "seal": {
            "revision": revision,
            "task_id": data.get("id") or task_dir.name,
            "task_name": task_dir.name,
            "documents": documents,
            "document_digests": {name: sha256((task_dir / name).read_bytes()).hexdigest() for name in documents},
            "execution_class": execution,
            "delivery_mode": delivery,
            "plan_digest": actual_digest,
            "sealed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return revision


def _require_seal(data: dict[str, Any], task_dir: Path, required_stage: str = "user_review") -> dict[str, Any]:
    execution, delivery = classification(data)
    record = planning_record(data)
    seal = record.get("seal")
    if not isinstance(seal, dict) or type(seal.get("revision")) is not int or seal.get("revision") != record["revision"]:
        raise PlanningError("current material plan is not sealed; use task.py plan seal")
    if seal.get("task_id") != (data.get("id") or task_dir.name) or seal.get("task_name") != task_dir.name:
        raise PlanningError("sealed plan belongs to another task")
    if seal.get("execution_class") != execution or seal.get("delivery_mode") != delivery:
        raise PlanningError("plan classification changed; reseal the material plan")
    if seal.get("documents") != _plan_documents(task_dir, execution, delivery):
        raise PlanningError("sealed plan documents do not match this task")
    if seal.get("document_digests") != {name: sha256((task_dir / name).read_bytes()).hexdigest() for name in seal["documents"]}:
        raise PlanningError("sealed plan content changed or lacks content digests; reseal the material plan")
    if seal.get("plan_digest") != plan_digest(data, task_dir) or record.get("review_digest") != seal.get("plan_digest"):
        raise PlanningError("sealed plan digest is stale; review the current complete plan again")
    if record.get("stage") != required_stage:
        raise PlanningError(f"plan receipt requires stage={required_stage}")
    if any(item["status"] == "open" for item in validate_decisions(task_dir)):
        raise PlanningError("open decisions prevent plan approval")
    validate_implementation_plan(task_dir)
    return record


def approve_plan(data: dict[str, Any], task_dir: Path, revision: int, basis: str) -> None:
    record = _require_seal(data, task_dir)
    if revision != record["revision"]:
        raise PlanningError(f"approval revision must match current revision {record['revision']}")
    if not isinstance(basis, str) or not basis.strip() or len(basis) > 1024 or "\x00" in basis:
        raise PlanningError("approval basis must be non-empty bounded text without credentials")
    record.update({
        "approved_revision": revision,
        "approval_basis": basis.strip(),
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "stage": "plan_closed",
    })
    data["meta"]["planning"] = record


def require_start_approval(data: dict[str, Any], task_dir: Path) -> None:
    if data.get("status") not in {"planning", "in_progress"}:
        raise PlanningError("start requires an active planning or in_progress task")
    # Existing running tasks retain their authorization; only crossing the
    # planning boundary is gated. Selecting a task never crosses that boundary.
    if data.get("status") == "in_progress":
        return
    execution, delivery = classification(data)
    if delivery == "analysis_only":
        raise PlanningError("analysis_only tasks remain in planning and cannot be started")
    if execution == "planned" and delivery == "change_bearing":
        record = _require_seal(data, task_dir, "plan_closed")
        if type(record.get("approved_revision")) is not int or record.get("approved_revision") != record["revision"] or not record.get("approval_basis"):
            raise PlanningError("current sealed plan has no matching implementation approval; use task.py plan approve only after the user explicitly approves the displayed plan")
    elif execution == "direct" and delivery == "change_bearing":
        if planning_record(data).get("stage") != "direct_ready":
            raise PlanningError("direct change-bearing tasks require stage=direct_ready before start")
        validate_direct_plan(data, task_dir)


def prepare_archive(data: dict[str, Any], task_dir: Path, reason: str | None) -> None:
    if data.get("status") != "planning":
        return
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 1024:
        raise PlanningError("archiving a planning task requires --reason with the analysis result or abandonment reason")
    record = planning_record(data)
    meta = data.get("meta", {})
    if not isinstance(meta, dict):
        raise PlanningError("task meta must be an object")
    if "execution_class" in meta or "delivery_mode" in meta:
        _, delivery = classification(data)
    else:
        delivery = None
    if delivery == "analysis_only":
        if record.get("stage") != "evidence":
            raise PlanningError("analysis-only archive requires stage=evidence and a completed evidence review")
        research = task_dir / "research"
        evidence_files = [path for path in research.glob("*.md") if path.is_file() and not path.is_symlink()] if research.is_dir() and not research.is_symlink() else []
        if not evidence_files:
            raise PlanningError("analysis-only archive requires at least one regular research/*.md evidence file")
        kind = "analysis_complete"
    else:
        kind = "administrative_abandonment"
    record["archive"] = {"kind": kind, "reason": reason.strip(), "recorded_at": datetime.now(timezone.utc).isoformat()}
    data.setdefault("meta", {})["planning"] = record
