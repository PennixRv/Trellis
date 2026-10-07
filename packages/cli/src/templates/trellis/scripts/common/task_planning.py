"""Task-local material plan revisions; chat approval remains coordinator-owned."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any


class PlanningError(ValueError):
    """A planning contract needs correction before a task can start."""


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
    return {**record, "revision": revision}


def invalidate_plan(data: dict[str, Any]) -> None:
    record = planning_record(data)
    data.setdefault("meta", {})["planning"] = {"revision": record["revision"] + 1}


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


def seal_plan(data: dict[str, Any], task_dir: Path) -> int:
    execution, delivery = classification(data)
    documents = _plan_documents(task_dir, execution, delivery)
    record = planning_record(data)
    # Resealing an already sealed plan declares a material new version. A replan
    # already advanced the revision; its first seal keeps that revision.
    revision = record["revision"] + (1 if record.get("seal") else 0)
    data.setdefault("meta", {})["planning"] = {
        "revision": revision,
        "seal": {
            "revision": revision,
            "task_id": data.get("id") or task_dir.name,
            "task_name": task_dir.name,
            "documents": documents,
            "document_digests": {name: sha256((task_dir / name).read_bytes()).hexdigest() for name in documents},
            "execution_class": execution,
            "delivery_mode": delivery,
            "sealed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return revision


def _require_seal(data: dict[str, Any], task_dir: Path) -> dict[str, Any]:
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
    return record


def approve_plan(data: dict[str, Any], task_dir: Path, revision: int, basis: str) -> None:
    record = _require_seal(data, task_dir)
    if revision != record["revision"]:
        raise PlanningError(f"approval revision must match current revision {record['revision']}")
    if not basis.strip() or len(basis) > 1024 or "\x00" in basis:
        raise PlanningError("approval basis must be non-empty bounded text without credentials")
    record.update({
        "approved_revision": revision,
        "approval_basis": basis.strip(),
        "approved_at": datetime.now(timezone.utc).isoformat(),
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
        record = _require_seal(data, task_dir)
        if type(record.get("approved_revision")) is not int or record.get("approved_revision") != record["revision"] or not record.get("approval_basis"):
            raise PlanningError("current sealed plan has no matching later implementation approval; use task.py plan approve only after the user's approval")
