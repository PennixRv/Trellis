"""Bounded, task-scoped Continuation Record runtime projection."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .active_task import resolve_active_task
from .git import run_git
from .io import read_json_checked
from .paths import FILE_TASK_JSON, get_repo_root


SCHEMA_VERSION = 1
KIND = "trellis-continuation-record"
STATUS_ABSENT = "absent"
STATUS_READY = "ready"
STATUS_STALE = "stale"
STATUS_WITHHELD = "withheld"
MAX_RECORD_BYTES = 128 * 1024
MAX_REQUEST_BYTES = 64 * 1024
MAX_TEXT_BYTES = 4096
MAX_LIST = 32
MAX_EVIDENCE = 32
MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
MAX_TASK_FILES = 512
MAX_TASK_FILE_BYTES = 2 * 1024 * 1024
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
SECRET = re.compile(
    r"(?:-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~+/=-]{20,}|"
    r"\b(?:sk|th)-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|password|secret)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


class ContinuationError(ValueError):
    """Raised when a Continuation Record cannot be safely read or written."""


class NoDirectCurrentTask(ContinuationError):
    """Raised when the current session has no directly bound active task."""


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value)).hexdigest()


def _text(value: Any, label: str, maximum: int = MAX_TEXT_BYTES) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > maximum:
        raise ContinuationError(f"{label} is invalid")
    if any(ord(char) < 32 and char not in "\n\t" for char in value) or SECRET.search(value):
        raise ContinuationError(f"{label} is unsafe")
    return value


def _list(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or len(value) > MAX_LIST:
        raise ContinuationError(f"{label} is invalid")
    return [_text(item, f"{label}[{index}]") for index, item in enumerate(value)]


def _safe_task_id(task_id: Any) -> str:
    value = _text(task_id, "task.id", 128)
    if not SAFE_ID.fullmatch(value) or "/" in value or "\\" in value or value in {".", ".."}:
        raise ContinuationError("task.id is unsafe")
    return value


def _record_path(root: Path, task_id: str) -> Path:
    safe_id = _safe_task_id(task_id)
    runtime = root / ".trellis" / ".runtime"
    records = runtime / "continuation-records"
    task_dir = records / safe_id
    if runtime.is_symlink() or records.is_symlink() or task_dir.is_symlink():
        raise ContinuationError("continuation record directory is unsafe")
    return task_dir / "record.json"


def _regular(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ContinuationError(f"{label} is not a regular file")
    return path


def _project_file(root: Path, value: Any, label: str) -> Path:
    relative = _text(value, label, 1024)
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts or relative.startswith(".trellis/.runtime/"):
        raise ContinuationError(f"{label} must be project-relative")
    cursor = root
    for part in candidate.parts:
        cursor /= part
        if cursor.is_symlink():
            raise ContinuationError(f"{label} contains a symbolic path")
    resolved = (root / candidate).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ContinuationError(f"{label} escapes project") from exc
    return resolved


def _file_digest(path: Path, maximum: int = MAX_EVIDENCE_BYTES) -> tuple[str, int]:
    hasher = hashlib.sha256()
    size = 0
    with _regular(path, "evidence file").open("rb") as handle:
        while chunk := handle.read(256 * 1024):
            size += len(chunk)
            if size > maximum:
                raise ContinuationError("source file is too large")
            hasher.update(chunk)
    return "sha256:" + hasher.hexdigest(), size


def _task_source(root: Path) -> dict[str, Any]:
    active = resolve_active_task(root)
    if not active.task_path:
        raise NoDirectCurrentTask("no_direct_current_task")
    if active.source_type == "session-fallback":
        raise ContinuationError("session_fallback_untrusted")
    if active.source_type != "session" or not active.context_key:
        raise NoDirectCurrentTask("no_direct_current_task")
    if active.stale:
        raise ContinuationError("current_session_pointer_stale")
    task_path = _project_file(root, active.task_path, "task path")
    task_file = _regular(task_path / FILE_TASK_JSON, "task.json")
    data, reason = read_json_checked(task_file)
    if data is None:
        raise ContinuationError(f"task.json is {reason}")
    task_id = _safe_task_id(data.get("id") or data.get("name"))
    entries: list[dict[str, Any]] = []
    for item in sorted(task_path.rglob("*")):
        if item.is_symlink() or not item.is_file():
            continue
        if len(entries) >= MAX_TASK_FILES:
            raise ContinuationError("task has too many material files")
        item_digest, size = _file_digest(item, MAX_TASK_FILE_BYTES)
        entries.append({"path": item.relative_to(root).as_posix(), "bytes": size, "sha256": item_digest})
    return {
        "id": task_id,
        "path": active.task_path,
        "status": _text(data.get("status"), "task.status", 64),
        "material_digest": _digest(entries),
        "context_key": active.context_key,
    }


def _git_source(root: Path) -> dict[str, Any]:
    def run(*args: str) -> str:
        rc, out, _ = run_git(list(args), cwd=root, timeout=20)
        if rc:
            raise ContinuationError("git source snapshot failed")
        return out.strip()

    dirty = [
        line
        for line in run("status", "--porcelain=v1").splitlines()
        if line and ".trellis/.runtime/continuation-records/" not in line[3:]
    ]
    branch = run("branch", "--show-current")
    head = run("rev-parse", "HEAD")
    return {
        "branch": branch or None,
        "head": _text(head, "git.head", 128),
        "worktree_state": "dirty" if dirty else "clean",
        "dirty_paths_digest": _digest(dirty),
    }


def _evidence(root: Path, values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list) or len(values) > MAX_EVIDENCE:
        raise ContinuationError("evidence must be a bounded list")
    result = []
    seen: set[str] = set()
    for item in values:
        path = _project_file(root, item, "evidence path")
        relative = path.relative_to(root).as_posix()
        if relative in seen:
            raise ContinuationError("evidence paths must be unique")
        seen.add(relative)
        file_digest, size = _file_digest(path)
        result.append({"path": relative, "bytes": size, "sha256": file_digest})
    return result


def _source(root: Path, task: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
    git = _git_source(root)
    source = {
        "task": {key: task[key] for key in ("id", "path", "status", "material_digest")},
        "git": git,
        "evidence": evidence,
    }
    source["source_digest"] = _digest(source)
    return source


def _request(root: Path, path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    _regular(path, "continuity request")
    if path.stat().st_size > MAX_REQUEST_BYTES:
        raise ContinuationError("continuity request is too large")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ContinuationError("continuity request is invalid") from exc
    if not isinstance(value, dict) or set(value) != {"objective", "decisions", "completed", "open_items", "blockers", "next_safe_action", "non_transferable_operations", "evidence"}:
        raise ContinuationError("continuity request fields are invalid")
    content = {key: _text(value[key], f"content.{key}") if key in {"objective", "next_safe_action"} else _list(value[key], f"content.{key}") for key in value if key != "evidence"}
    return content, _evidence(root, value["evidence"])


def _request_path(root: Path, path: Path) -> Path:
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise ContinuationError("continuity request must be project-relative") from exc
    return _project_file(root, relative.as_posix(), "continuity request")


def _expected_digest(value: str) -> str:
    if value == "absent" or SHA256.fullmatch(value):
        return value
    raise ContinuationError("expected record digest is invalid")


def _ensure_record_parent(path: Path) -> None:
    if path.parent.is_symlink() or path.parent.parent.is_symlink():
        raise ContinuationError("continuation record directory is unsafe")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink() or path.parent.parent.is_symlink():
        raise ContinuationError("continuation record directory is unsafe")
    os.chmod(path.parent.parent, 0o700)
    os.chmod(path.parent, 0o700)


@contextmanager
def _record_lock(path: Path):
    _ensure_record_parent(path)
    lock = path.parent / ".lock"
    if lock.is_symlink():
        raise ContinuationError("continuation record lock is unsafe")
    # ponytail: one advisory lock per task record; a lock service is unnecessary unless distributed writers are introduced.
    with lock.open("a+", encoding="utf-8") as handle:
        try:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        except (ImportError, OSError) as exc:
            raise ContinuationError("continuation record lock unavailable") from exc
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _record_digest(record: dict[str, Any]) -> str:
    return _digest({key: value for key, value in record.items() if key != "integrity"})


def _decode(path: Path) -> dict[str, Any]:
    _regular(path, "continuation record")
    if path.stat().st_size > MAX_RECORD_BYTES:
        raise ContinuationError("continuation record is too large")
    data, reason = read_json_checked(path)
    if data is None:
        raise ContinuationError(f"continuation record is {reason}")
    expected = {"schema_version", "kind", "task", "source", "content", "revision", "updated_at", "integrity"}
    if set(data) != expected or data["schema_version"] != SCHEMA_VERSION or data["kind"] != KIND:
        raise ContinuationError("continuation record schema is unsupported")
    task = data["task"]
    if not isinstance(task, dict) or set(task) != {"id", "path", "status", "material_digest"}:
        raise ContinuationError("continuation record task is invalid")
    _safe_task_id(task["id"])
    task_path = _text(task["path"], "task.path", 1024)
    task_path_value = Path(task_path)
    if task_path_value.is_absolute() or ".." in task_path_value.parts or not task_path.startswith(".trellis/tasks/"):
        raise ContinuationError("task.path is unsafe")
    _text(task["status"], "task.status", 64)
    if not SHA256.fullmatch(task["material_digest"]):
        raise ContinuationError("task.material_digest is invalid")
    source = data["source"]
    if not isinstance(source, dict) or set(source) != {"task", "git", "evidence", "source_digest"}:
        raise ContinuationError("continuation record source is invalid")
    if source["task"] != task:
        raise ContinuationError("continuation record task source is invalid")
    git = source["git"]
    if not isinstance(git, dict) or set(git) != {"branch", "head", "worktree_state", "dirty_paths_digest"}:
        raise ContinuationError("continuation record git source is invalid")
    if git["branch"] is not None:
        _text(git["branch"], "git.branch", 512)
    _text(git["head"], "git.head", 128)
    if git["worktree_state"] not in {"clean", "dirty"} or not SHA256.fullmatch(git["dirty_paths_digest"]):
        raise ContinuationError("continuation record git source is invalid")
    if not isinstance(source["evidence"], list) or len(source["evidence"]) > MAX_EVIDENCE:
        raise ContinuationError("continuation record evidence is invalid")
    for index, item in enumerate(source["evidence"]):
        if not isinstance(item, dict) or set(item) != {"path", "bytes", "sha256"}:
            raise ContinuationError("continuation record evidence item is invalid")
        _text(item["path"], f"evidence[{index}].path", 1024)
        if not isinstance(item["bytes"], int) or item["bytes"] < 0 or not SHA256.fullmatch(item["sha256"]):
            raise ContinuationError("continuation record evidence item is invalid")
    if not SHA256.fullmatch(source["source_digest"]):
        raise ContinuationError("source digest is invalid")
    if source["source_digest"] != _digest({key: value for key, value in source.items() if key != "source_digest"}):
        raise ContinuationError("source digest does not match")
    content = data["content"]
    if not isinstance(content, dict) or set(content) != {"objective", "decisions", "completed", "open_items", "blockers", "next_safe_action", "non_transferable_operations"}:
        raise ContinuationError("continuation record content is invalid")
    _text(content["objective"], "content.objective")
    _text(content["next_safe_action"], "content.next_safe_action")
    for key in ("decisions", "completed", "open_items", "blockers", "non_transferable_operations"):
        _list(content[key], f"content.{key}")
    if not isinstance(data["revision"], int) or data["revision"] < 1:
        raise ContinuationError("revision is invalid")
    _text(data["updated_at"], "updated_at", 128)
    integrity = data["integrity"]
    if not isinstance(integrity, dict) or set(integrity) != {"record_digest"} or not SHA256.fullmatch(integrity["record_digest"]):
        raise ContinuationError("record digest is invalid")
    if integrity["record_digest"] != _record_digest(data):
        raise ContinuationError("record digest does not match")
    return data


def status(root: Path | None = None) -> dict[str, Any]:
    root = (root or get_repo_root()).resolve()
    try:
        task = _task_source(root)
    except NoDirectCurrentTask:
        return {"status": STATUS_ABSENT, "reason": "no_direct_current_task"}
    except ContinuationError as exc:
        return {"status": STATUS_WITHHELD, "reason": str(exc)}
    try:
        path = _record_path(root, task["id"])
    except ContinuationError as exc:
        return {"status": STATUS_WITHHELD, "reason": str(exc)}
    if not path.exists():
        return {"status": STATUS_ABSENT, "task": {key: task[key] for key in ("id", "path", "status")}}
    try:
        record = _decode(path)
        current = _source(root, task, _evidence(root, [item["path"] for item in record["source"]["evidence"]]))
        state = STATUS_READY if record["source"] == current else STATUS_STALE
        result = {"status": state, "task": record["task"], "revision": record["revision"], "record_digest": record["integrity"]["record_digest"]}
        if state == STATUS_READY:
            result["content"] = record["content"]
        else:
            result["reason"] = "source_drift"
        return result
    except (ContinuationError, OSError) as exc:
        return {"status": STATUS_WITHHELD, "task": {key: task[key] for key in ("id", "path", "status")}, "reason": str(exc)}


def seal(root: Path, request_path: Path, expected: str) -> dict[str, Any]:
    expected = _expected_digest(expected)
    request_path = _request_path(root, request_path)
    task = _task_source(root)
    path = _record_path(root, task["id"])
    with _record_lock(path):
        task = _task_source(root)
        current_digest: str | None = None
        current: dict[str, Any] | None = None
        if path.exists():
            current = _decode(path)
            current_digest = current["integrity"]["record_digest"]
            current_source = _source(root, task, _evidence(root, [item["path"] for item in current["source"]["evidence"]]))
            if current["source"] != current_source:
                raise ContinuationError("existing continuation record source drifted")
        if expected != "absent" and expected != current_digest:
            raise ContinuationError("expected record digest does not match")
        if expected == "absent" and current_digest is not None:
            raise ContinuationError("record already exists")
        content, evidence = _request(root, request_path)
        source = _source(root, task, evidence)
        current_task = _task_source(root)
        if task != current_task or source != _source(root, current_task, _evidence(root, [item["path"] for item in evidence])):
            raise ContinuationError("continuation source changed while sealing")
        record: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "kind": KIND,
            "task": {key: task[key] for key in ("id", "path", "status", "material_digest")},
            "source": source,
            "content": content,
            "revision": 1 if current is None else current["revision"] + 1,
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        }
        record["integrity"] = {"record_digest": _record_digest(record)}
        encoded = json.dumps(record, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
        if len(encoded.encode("utf-8")) > MAX_RECORD_BYTES:
            raise ContinuationError("continuation record is too large")
        temporary: Path | None = None
        try:
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
            raise ContinuationError("continuation record atomic write failed") from exc
        return {"status": STATUS_READY, "revision": record["revision"], "record_digest": record["integrity"]["record_digest"]}


def clear(root: Path, expected: str) -> dict[str, Any]:
    expected = _expected_digest(expected)
    task = _task_source(root)
    path = _record_path(root, task["id"])
    with _record_lock(path):
        if not path.exists():
            if expected == "absent":
                return {"status": STATUS_ABSENT}
            raise ContinuationError("record is absent")
        record = _decode(path)
        actual = record["integrity"]["record_digest"]
        if actual != expected:
            raise ContinuationError("expected record digest does not match")
        path.unlink()
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"status": STATUS_ABSENT, "cleared": actual}
