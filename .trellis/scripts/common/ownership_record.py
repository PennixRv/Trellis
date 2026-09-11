"""Task-bound ownership transfer for formal cross-session handoff."""

from __future__ import annotations

import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .active_task import clear_active_task, resolve_active_task, resolve_context_key, set_active_task
from .continuation_record import (
    ContinuationError,
    SAFE_ID,
    SHA256,
    _digest,
    _project_file,
    _record_lock,
    _safe_task_id,
    _text,
)
from .io import read_json_checked
from .paths import FILE_TASK_JSON, get_repo_root


KIND = "trellis-handoff-ownership"
SCHEMA_VERSION = 1
STATES = {"quiescing", "sealed", "retiring", "ready", "claiming", "claimed", "consumed", "archived"}
ARCHIVE_OBSERVATIONS = {"not_required", "observed"}
MAX_RECORD_BYTES = 32 * 1024


class OwnershipError(ContinuationError):
    """Raised when a handoff ownership transition is unsafe or stale."""


def _identity(value: Any, label: str) -> str:
    value = _text(value, label, 160)
    if not SAFE_ID.fullmatch(value):
        raise OwnershipError(f"{label} is unsafe")
    return value


def _record_path(root: Path, task_id: str, handoff_id: str) -> Path:
    task_id = _safe_task_id(task_id)
    handoff_id = _identity(handoff_id, "handoff_id")
    runtime = root / ".trellis" / ".runtime"
    records = runtime / "handoff-ownership"
    task_dir = records / task_id
    if runtime.is_symlink() or records.is_symlink() or task_dir.is_symlink():
        raise OwnershipError("ownership record directory is unsafe")
    return task_dir / f"{handoff_id}.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _task_snapshot(root: Path, task_path: str) -> dict[str, str]:
    path = _project_file(root, task_path, "task path")
    relative = path.relative_to(root).as_posix()
    if not relative.startswith(".trellis/tasks/"):
        raise OwnershipError("task path is outside .trellis/tasks")
    data, reason = read_json_checked(path / FILE_TASK_JSON)
    if data is None:
        raise OwnershipError(f"task.json is {reason}")
    task_id = _safe_task_id(data.get("id") or data.get("name"))
    return {"id": task_id, "path": relative, "status": _text(data.get("status"), "task.status", 64)}


def _direct_context(root: Path, require_task: bool = False) -> tuple[str, Any]:
    context_key = resolve_context_key()
    if not context_key:
        raise OwnershipError("no_direct_session_identity")
    active = resolve_active_task(
        root,
        allow_single_session_fallback=False,
        allow_environment_context=True,
    )
    if active.source_type == "session-fallback":
        raise OwnershipError("session_fallback_untrusted")
    if active.context_key != context_key:
        raise OwnershipError("direct_session_identity_unstable")
    if require_task and not active.task_path:
        raise OwnershipError("no_direct_current_task")
    return context_key, active


def _new_record(task: dict[str, str], handoff_id: str, core_digest: str, source: str) -> dict[str, Any]:
    if not SHA256.fullmatch(core_digest):
        raise OwnershipError("core_digest is invalid")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": KIND,
        "handoff_id": _identity(handoff_id, "handoff_id"),
        "core_digest": core_digest,
        "task": task,
        "source_session_id": source,
        "source_context_key": source,
        "consumer_session_id": None,
        "consumer_context_key": None,
        "state": "quiescing",
        "generation": 0,
        "fencing_token": secrets.token_hex(16),
        "archive_observation": None,
        "event_id": f"event-{secrets.token_hex(12)}",
        "previous_event_digest": None,
        "updated_at": _now(),
    }


def _record_digest(record: dict[str, Any]) -> str:
    return _digest({key: value for key, value in record.items() if key != "integrity"})


def _decode(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_RECORD_BYTES:
        raise OwnershipError("ownership record is unsafe or too large")
    data, reason = read_json_checked(path)
    if data is None:
        raise OwnershipError(f"ownership record is {reason}")
    required = {
        "schema_version", "kind", "handoff_id", "core_digest", "task",
        "source_session_id", "source_context_key", "consumer_session_id",
        "consumer_context_key", "state", "generation", "fencing_token",
        "archive_observation", "event_id", "previous_event_digest", "updated_at", "integrity",
    }
    if set(data) != required or data["schema_version"] != SCHEMA_VERSION or data["kind"] != KIND:
        raise OwnershipError("ownership record schema is unsupported")
    _identity(data["handoff_id"], "handoff_id")
    if not SHA256.fullmatch(data["core_digest"]):
        raise OwnershipError("core_digest is invalid")
    task = data["task"]
    if not isinstance(task, dict) or set(task) != {"id", "path", "status"}:
        raise OwnershipError("ownership task is invalid")
    _safe_task_id(task["id"])
    _text(task["path"], "task.path", 1024)
    _text(task["status"], "task.status", 64)
    for key in ("source_session_id", "source_context_key"):
        _identity(data[key], key)
    for key in ("consumer_session_id", "consumer_context_key"):
        if data[key] is not None:
            _identity(data[key], key)
    if data["state"] not in STATES or not isinstance(data["generation"], int) or data["generation"] < 0:
        raise OwnershipError("ownership state is invalid")
    _identity(data["fencing_token"], "fencing_token")
    if data["archive_observation"] is not None and data["archive_observation"] not in ARCHIVE_OBSERVATIONS:
        raise OwnershipError("archive observation is invalid")
    _identity(data["event_id"], "event_id")
    if data["previous_event_digest"] is not None and not SHA256.fullmatch(data["previous_event_digest"]):
        raise OwnershipError("previous event digest is invalid")
    _text(data["updated_at"], "updated_at", 128)
    integrity = data["integrity"]
    if not isinstance(integrity, dict) or set(integrity) != {"record_digest"} or not SHA256.fullmatch(integrity["record_digest"]):
        raise OwnershipError("ownership integrity is invalid")
    if integrity["record_digest"] != _record_digest(data):
        raise OwnershipError("ownership record digest does not match")
    return data


def _write(path: Path, record: dict[str, Any]) -> str:
    record["event_id"] = f"event-{secrets.token_hex(12)}"
    record["updated_at"] = _now()
    record["integrity"] = {"record_digest": _record_digest(record)}
    encoded = json.dumps(record, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    if len(encoded.encode("utf-8")) > MAX_RECORD_BYTES:
        raise OwnershipError("ownership record is too large")
    temporary: Path | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as exc:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise OwnershipError("ownership record atomic write failed") from exc
    return record["integrity"]["record_digest"]


def _load(root: Path, task_id: str, handoff_id: str) -> tuple[Path, dict[str, Any]]:
    path = _record_path(root, task_id, handoff_id)
    if not path.exists():
        raise OwnershipError("ownership record is absent")
    return path, _decode(path)


def _check(record: dict[str, Any], core_digest: str, expected_generation: int, actor: str) -> None:
    if record["core_digest"] != core_digest:
        raise OwnershipError("core_digest does not match")
    if record["generation"] != expected_generation:
        raise OwnershipError("expected ownership generation does not match")
    if record["source_session_id"] != actor and record.get("consumer_session_id") != actor:
        raise OwnershipError("session is not an ownership actor")


def _public(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": record["state"],
        "handoff_id": record["handoff_id"],
        "core_digest": record["core_digest"],
        "task": record["task"],
        "source_session_id": record["source_session_id"],
        "consumer_session_id": record["consumer_session_id"],
        "generation": record["generation"],
        "archive_observation": record["archive_observation"],
        "record_digest": record["integrity"]["record_digest"],
        "updated_at": record["updated_at"],
    }


def quiesce(root: Path, task_path: str, handoff_id: str, core_digest: str, source_session_id: str) -> dict[str, Any]:
    actor, active = _direct_context(root, require_task=True)
    task = _task_snapshot(root, task_path)
    if active.source_type != "session" or active.context_key != actor or active.task_path != task["path"]:
        raise OwnershipError("source task is not the direct current task")
    if _identity(source_session_id, "source_session_id") != actor:
        raise OwnershipError("source_session_id does not match direct session")
    path = _record_path(root, task["id"], handoff_id)
    with _record_lock(path):
        if path.exists():
            raise OwnershipError("ownership record already exists")
        record = _new_record(task, handoff_id, core_digest, actor)
        digest = _write(path, record)
    return {"status": "quiescing", "generation": 0, "record_digest": digest}


def seal(root: Path, task_id: str, handoff_id: str, core_digest: str, expected_generation: int) -> dict[str, Any]:
    actor, _ = _direct_context(root)
    path, record = _load(root, task_id, handoff_id)
    with _record_lock(path):
        record = _decode(path)
        _check(record, core_digest, expected_generation, actor)
        if record["state"] != "quiescing" or record["source_session_id"] != actor:
            raise OwnershipError("ownership record is not sealable by source")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "sealed"
        record["generation"] += 1
        digest = _write(path, record)
    return _public(record) | {"record_digest": digest}


def retire(root: Path, task_id: str, handoff_id: str, core_digest: str, expected_generation: int, archive_observation: str) -> dict[str, Any]:
    if archive_observation not in ARCHIVE_OBSERVATIONS:
        raise OwnershipError("archive observation is invalid")
    actor, active = _direct_context(root)
    path, record = _load(root, task_id, handoff_id)
    with _record_lock(path):
        record = _decode(path)
        _check(record, core_digest, expected_generation, actor)
        if record["source_session_id"] != actor or record["state"] not in {"sealed", "retiring"}:
            raise OwnershipError("ownership record is not retireable by source")
        if record["state"] == "sealed":
            if active.task_path != record["task"]["path"]:
                raise OwnershipError("source task is not bound for retirement")
            record["previous_event_digest"] = record["integrity"]["record_digest"]
            record["state"] = "retiring"
            record["archive_observation"] = archive_observation
            record["generation"] += 1
            record["fencing_token"] = secrets.token_hex(16)
            _write(path, record)
        elif record["archive_observation"] != archive_observation:
            raise OwnershipError("archive observation does not match retirement")

        active = resolve_active_task(root, allow_single_session_fallback=False)
        if active.context_key != actor:
            raise OwnershipError("direct_session_identity_unstable")
        if active.task_path == record["task"]["path"]:
            clear_active_task(root)
        elif active.task_path:
            raise OwnershipError("source task pointer changed during retirement")
        active = resolve_active_task(root, allow_single_session_fallback=False)
        if active.context_key != actor or active.task_path:
            raise OwnershipError("source task retirement could not be verified; recovery_required")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "ready"
        record["generation"] += 1
        digest = _write(path, record)
    return _public(record) | {"record_digest": digest}


def claim(root: Path, task_id: str, task_path: str, handoff_id: str, core_digest: str, expected_generation: int) -> dict[str, Any]:
    actor, active = _direct_context(root)
    path, record = _load(root, task_id, handoff_id)
    with _record_lock(path):
        record = _decode(path)
        if record["core_digest"] != core_digest:
            raise OwnershipError("expected ownership claim does not match")
        if record["state"] == "claimed" and record.get("consumer_session_id") == actor:
            if active.task_path != record["task"]["path"]:
                raise OwnershipError("claimed consumer task pointer is missing")
            return _public(record)
        if record["state"] == "claiming" and record.get("consumer_session_id") == actor:
            if active.task_path and active.task_path != record["task"]["path"]:
                raise OwnershipError("target task pointer changed during claim; recovery_required")
            if not active.task_path:
                bound = set_active_task(record["task"]["path"], root)
                if not bound:
                    raise OwnershipError("target task binding failed; recovery_required")
                active = resolve_active_task(root, allow_single_session_fallback=False)
            if active.context_key != actor or active.task_path != record["task"]["path"]:
                raise OwnershipError("target task binding could not be verified; recovery_required")
            record["previous_event_digest"] = record["integrity"]["record_digest"]
            record["state"] = "claimed"
            record["generation"] += 1
            digest = _write(path, record)
            return _public(record) | {"record_digest": digest}
        if record["generation"] != expected_generation:
            raise OwnershipError("expected ownership claim does not match")
        if record["state"] != "ready":
            raise OwnershipError("ownership record is not claimable")
        if active.task_path:
            raise OwnershipError("target session already has a direct task")
        task = _task_snapshot(root, task_path)
        if task != record["task"]:
            raise OwnershipError("target task does not match ownership record")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "claiming"
        record["consumer_session_id"] = actor
        record["consumer_context_key"] = actor
        record["generation"] += 1
        record["fencing_token"] = secrets.token_hex(16)
        _write(path, record)
        bound = set_active_task(task["path"], root)
        if not bound:
            raise OwnershipError("target task binding failed; recovery_required")
        active = resolve_active_task(root, allow_single_session_fallback=False)
        if active.context_key != actor or active.task_path != task["path"]:
            raise OwnershipError("target task binding could not be verified; recovery_required")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "claimed"
        record["generation"] += 1
        digest = _write(path, record)
    return _public(record) | {"record_digest": digest}


def consume(root: Path, task_id: str, handoff_id: str, core_digest: str, expected_generation: int) -> dict[str, Any]:
    actor, _ = _direct_context(root, require_task=True)
    path, record = _load(root, task_id, handoff_id)
    with _record_lock(path):
        record = _decode(path)
        if record["state"] == "consumed" and record.get("consumer_session_id") == actor:
            return _public(record)
        _check(record, core_digest, expected_generation, actor)
        if record["state"] != "claimed" or record.get("consumer_session_id") != actor:
            raise OwnershipError("ownership record is not consumable by current consumer")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "consumed"
        record["generation"] += 1
        digest = _write(path, record)
    return _public(record) | {"record_digest": digest}


def archive(root: Path, task_id: str, handoff_id: str, core_digest: str, expected_generation: int) -> dict[str, Any]:
    actor, _ = _direct_context(root, require_task=True)
    path, record = _load(root, task_id, handoff_id)
    with _record_lock(path):
        record = _decode(path)
        if record["state"] == "archived" and record.get("consumer_session_id") == actor:
            return _public(record)
        _check(record, core_digest, expected_generation, actor)
        if record["state"] != "consumed" or record.get("consumer_session_id") != actor:
            raise OwnershipError("ownership record is not archiveable by current consumer")
        record["previous_event_digest"] = record["integrity"]["record_digest"]
        record["state"] = "archived"
        record["generation"] += 1
        digest = _write(path, record)
    return _public(record) | {"record_digest": digest}


def status(root: Path | None, task_id: str, handoff_id: str, core_digest: str) -> dict[str, Any]:
    root = (root or get_repo_root()).resolve()
    _, record = _load(root, task_id, handoff_id)
    if record["core_digest"] != core_digest:
        raise OwnershipError("core_digest does not match")
    return _public(record)


def assert_task_mutation_allowed(root: Path, task_path: Path) -> None:
    """Reject ordinary task pointer changes that would bypass ownership fencing."""
    actor = resolve_context_key()
    if not actor:
        return
    try:
        task_id = _safe_task_id(task_path.name)
    except ContinuationError:
        return
    relative = task_path.relative_to(root).as_posix()
    records_dir = root / ".trellis" / ".runtime" / "handoff-ownership" / task_id
    if not records_dir.is_dir() or records_dir.is_symlink():
        return
    for record_path in sorted(records_dir.glob("*.json")):
        if record_path.is_symlink():
            raise OwnershipError("ownership record is unsafe")
        record = _decode(record_path)
        if record["state"] not in STATES:
            continue
        if record["task"]["path"] != relative:
            raise OwnershipError("ownership record task path does not match current task")
        if record.get("consumer_session_id") == actor:
            continue
        if record["source_session_id"] == actor or record["state"] in {"retiring", "ready", "claiming", "claimed", "consumed", "archived"}:
            raise OwnershipError("fencing_conflict: task is owned by another handoff session")
