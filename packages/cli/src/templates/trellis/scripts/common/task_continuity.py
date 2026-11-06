"""Current-task continuity snapshots and explicit session ownership transfer."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
from pathlib import Path

from .active_task import (
    compare_and_set_active_task,
    clear_active_task_if_matches,
    resolve_active_task,
)
from .git import run_git
from .io import JSON_READ_MISSING, read_json_checked, write_json
from .paths import FILE_TASK_JSON, get_repo_root
from .task_utils import is_within_tasks_dir, resolve_task_dir
from .task_workflow import TaskWorkflowError, _artifact_digest, _state


PACKAGE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
PACKAGE_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


class ContinuityError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _key(task_path: str) -> str:
    return hashlib.sha256(task_path.encode("utf-8")).hexdigest()


def _continuity_path(root: Path, task_path: str) -> Path:
    return root / ".trellis" / ".runtime" / "continuity" / f"{_key(task_path)}.json"


def _ownership_path(root: Path, task_path: str) -> Path:
    return root / ".trellis" / ".runtime" / "task-ownership" / f"{_key(task_path)}.json"


@contextlib.contextmanager
def _record_lock(path: Path):
    lock_path = path.with_suffix(".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
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


def _task(root: Path, task_path: str | None = None) -> tuple[Path, dict, str, str]:
    active = resolve_active_task(root)
    if active.stale or active.source_type == "session-fallback":
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "current task is stale or not directly bound to this session")
    if task_path is None:
        if not active.task_path:
            raise ContinuityError("TASK_CONTINUITY_ABSENT", "this direct session has no current task")
        task_path = active.task_path
    elif active.task_path != task_path:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "requested task is not the direct current task")
    directory = resolve_task_dir(task_path, root)
    if directory is None or not is_within_tasks_dir(directory, root):
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "task path is unavailable or unsafe")
    data, reason = read_json_checked(directory / FILE_TASK_JSON)
    if data is None:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"task record cannot be read: {reason}")
    task_id = data.get("id") or data.get("name")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "task identity is missing")
    if not active.context_key:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "direct session identity is unavailable")
    return directory, data, task_id, active.context_key


def _submodule_facts(root: Path) -> list[dict]:
    rc, output, _ = run_git(["submodule", "status", "--recursive"], cwd=root, timeout=20)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git submodule status is unavailable")
    facts = []
    for line in output.splitlines():
        if len(line) < 43:
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git submodule status is malformed")
        state, revision, relative_text = line[0], line[1:41], line[42:]
        if " (" in relative_text:
            relative_text = relative_text.rsplit(" (", 1)[0]
        relative = Path(relative_text)
        candidate = root / relative
        try:
            candidate.resolve(strict=True).relative_to(root.resolve())
        except (OSError, ValueError) as error:
            if state == "-" and not candidate.exists():
                facts.append({"path": relative.as_posix(), "revision": revision, "state": "uninitialized"})
                continue
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"submodule path is unavailable or unsafe: {relative}") from error
        if state == "-":
            facts.append({"path": relative.as_posix(), "revision": revision, "state": "uninitialized"})
            continue
        if not candidate.is_dir():
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"submodule path is not a directory: {relative}")
        rc, head, _ = run_git(["rev-parse", "HEAD"], cwd=candidate, timeout=5)
        rc_status, status, _ = run_git(["status", "--porcelain=v1", "--untracked-files=all"], cwd=candidate, timeout=10)
        rc_diff, diff, _ = run_git(["diff", "--binary", "HEAD", "--", "."], cwd=candidate, timeout=20)
        rc_untracked, untracked, _ = run_git(["ls-files", "--others", "--exclude-standard", "-z"], cwd=candidate, timeout=10)
        if any((rc, rc_status, rc_diff, rc_untracked)):
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"submodule worktree is unavailable: {relative}")
        digest = hashlib.sha256(diff.encode("utf-8", errors="surrogateescape"))
        for raw_path in sorted(os.fsencode(path) for path in untracked.split("\0") if path):
            path = candidate / Path(os.fsdecode(raw_path))
            try:
                path.resolve(strict=True).relative_to(candidate.resolve())
                if path.is_symlink():
                    content = os.fsencode(os.readlink(path))
                elif path.is_file():
                    content = path.read_bytes()
                else:
                    raise OSError("not a regular file or symbolic link")
            except (OSError, ValueError) as error:
                raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"submodule untracked path is unavailable or unsafe: {relative / path.name}") from error
            digest.update(raw_path)
            digest.update(b"\0")
            digest.update(content)
            digest.update(b"\0")
        facts.append({
            "path": relative.as_posix(),
            "revision": revision,
            "head": head.strip(),
            "state": state,
            "status_digest": hashlib.sha256(status.encode("utf-8")).hexdigest(),
            "content_digest": digest.hexdigest(),
        })
    return facts


def _projection(root: Path, directory: Path, data: dict, task_id: str) -> dict:
    meta = data.get("meta")
    if not isinstance(meta, dict):
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "task metadata is invalid")
    workflow = meta.get("task_workflow")
    phases: list[dict] = []
    evidence: list[str] = []
    route_revision = input_revision = current_phase = None
    if workflow is not None:
        try:
            state = _state(meta)
        except TaskWorkflowError as error:
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", str(error)) from error
        route_revision = state["task_route_revision"]
        input_revision = state["input_revision"]
        current_phase = state["current_phase_id"]
        for phase_id in state["phase_ids"]:
            record = state["phases"][phase_id]
            refs = record.get("artifact_refs", [])
            if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
                raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"phase artifact references are invalid: {phase_id}")
            try:
                artifact_digest = _artifact_digest(directory, refs)
            except TaskWorkflowError as error:
                raise ContinuityError("TASK_CONTINUITY_WITHHELD", str(error)) from error
            evidence_refs = record.get("evidence_refs", [])
            if not isinstance(evidence_refs, list) or not all(isinstance(ref, str) for ref in evidence_refs):
                raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"phase evidence references are invalid: {phase_id}")
            evidence.extend(evidence_refs)
            acceptance = record.get("acceptance")
            phases.append({
                "id": phase_id,
                "status": record.get("status"),
                "input_revision": record.get("input_revision"),
                "artifact_revision": record.get("artifact_revision"),
                "artifact_digest": artifact_digest,
                "result_revision": record.get("result_revision"),
                "result_ref": record.get("result_ref"),
                "outcome_kind": record.get("outcome_kind"),
                "evidence_refs": record.get("evidence_refs", []),
                "acceptance": acceptance,
            })
    rc, head, _ = run_git(["rev-parse", "HEAD"], cwd=root, timeout=5)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git HEAD is unavailable")
    rc, branch, _ = run_git(["branch", "--show-current"], cwd=root, timeout=5)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git branch is unavailable")
    rc, status, _ = run_git(["status", "--porcelain=v1", "--untracked-files=all"], cwd=root, timeout=10)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git working-tree status is unavailable")
    status = "".join(
        line for line in status.splitlines(keepends=True)
        if ".trellis/session-handoffs/" not in line[3:]
    )
    rc, diff, _ = run_git(["diff", "--binary", "HEAD", "--", "."], cwd=root, timeout=20)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git working-tree diff is unavailable")
    rc, untracked, _ = run_git(["ls-files", "--others", "--exclude-standard", "-z"], cwd=root, timeout=10)
    if rc:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", "Git untracked-file list is unavailable")
    worktree = hashlib.sha256(diff.encode("utf-8", errors="surrogateescape"))
    for raw_path in sorted(os.fsencode(path) for path in untracked.split("\0") if path):
        relative = Path(os.fsdecode(raw_path))
        if relative.parts[:2] == (".trellis", "session-handoffs"):
            continue
        candidate = root / relative
        try:
            candidate.resolve(strict=True).relative_to(root.resolve())
            if candidate.is_symlink():
                content = os.fsencode(os.readlink(candidate))
            elif candidate.is_file():
                content = candidate.read_bytes()
            else:
                raise OSError("not a regular file or symbolic link")
        except (OSError, ValueError) as error:
            raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"untracked path is unavailable or unsafe: {relative}") from error
        worktree.update(raw_path)
        worktree.update(b"\0")
        worktree.update(content)
        worktree.update(b"\0")
    submodules = _submodule_facts(root)
    worktree.update(json.dumps(submodules, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    evidence_digest = hashlib.sha256(
        json.dumps(sorted(evidence), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "task": {"id": task_id, "path": directory.relative_to(root).as_posix(), "status": data.get("status")},
        "phase": {"current_phase_id": current_phase, "task_route_revision": route_revision, "input_revision": input_revision, "phases": phases},
        "evidence_digest": evidence_digest,
        "git": {
            "head": head.strip(),
            "branch": branch.strip() or None,
            "clean": not status,
            "status_digest": hashlib.sha256(status.encode("utf-8")).hexdigest(),
            "content_digest": worktree.hexdigest(),
            "submodules": submodules,
        },
    }


def _digest(value: dict) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _read_record(path: Path) -> tuple[dict | None, str | None]:
    value, reason = read_json_checked(path)
    if value is None and reason == JSON_READ_MISSING:
        return None, None
    if value is None:
        raise ContinuityError("TASK_CONTINUITY_WITHHELD", f"runtime record cannot be read: {reason}")
    return value, None


def continuity_show(args: argparse.Namespace) -> int:
    root = get_repo_root()
    try:
        directory, data, task_id, _ = _task(root)
        current = _projection(root, directory, data, task_id)
        source_digest = _digest(current)
        task_path = directory.relative_to(root).as_posix()
        record, _ = _read_record(_continuity_path(root, task_path))
        if record is None:
            result = {"status": "absent", "source_digest": source_digest, "current": current}
        elif record.get("schema_version") != 1 or not isinstance(record.get("generation"), int):
            result = {"status": "withheld", "reason": "continuity record has an invalid shape"}
        else:
            result = {
                "status": "ready" if record.get("source_digest") == source_digest else "stale",
                "generation": record["generation"],
                "source_digest": source_digest,
                "captured_source_digest": record.get("source_digest"),
                "current": current,
            }
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except ContinuityError as error:
        status = "absent" if error.code == "TASK_CONTINUITY_ABSENT" else "withheld"
        print(json.dumps({"status": status, "code": error.code, "reason": str(error)}, ensure_ascii=False))
        return 0 if status == "absent" else 1


def continuity_capture(args: argparse.Namespace) -> int:
    root = get_repo_root()
    try:
        directory, data, task_id, _ = _task(root)
        current = _projection(root, directory, data, task_id)
        source_digest = _digest(current)
        task_path = directory.relative_to(root).as_posix()
        path = _continuity_path(root, task_path)
        with _record_lock(path):
            record, _ = _read_record(path)
            actual = record.get("source_digest") if record else "absent"
            if actual != args.expected_source_digest:
                raise ContinuityError("TASK_CONTINUITY_STALE", f"expected source digest {args.expected_source_digest}, current record is {actual}")
            latest = _projection(root, directory, data, task_id)
            if _digest(latest) != source_digest:
                raise ContinuityError("TASK_CONTINUITY_STALE", "task or Git sources changed while capturing continuity")
            generation = (record.get("generation", 0) + 1) if record else 1
            saved = {"schema_version": 1, "generation": generation, "source_digest": source_digest, "current": current}
            if not write_json(path, saved):
                raise ContinuityError("TASK_CONTINUITY_WRITE_FAILED", "could not atomically write continuity record")
        print(json.dumps({"status": "ready", "generation": generation, "source_digest": source_digest, "current": current}, ensure_ascii=False, sort_keys=True))
        return 0
    except ContinuityError as error:
        print(json.dumps({"status": "stale" if error.code == "TASK_CONTINUITY_STALE" else "withheld", "code": error.code, "reason": str(error)}, ensure_ascii=False))
        return 1


def _route_snapshot(data: dict) -> dict:
    meta = data.get("meta")
    if not isinstance(meta, dict):
        raise ContinuityError("TASK_TRANSFER_WITHHELD", "task metadata is invalid")
    workflow = meta.get("task_workflow")
    if workflow is None:
        return {"current_phase_id": None, "task_route_revision": None, "input_revision": None, "implementation_authorization": None}
    try:
        state = _state(meta)
    except TaskWorkflowError as error:
        raise ContinuityError("TASK_TRANSFER_WITHHELD", str(error)) from error
    authorization = state.get("implementation_authorization")
    return {
        "current_phase_id": state["current_phase_id"],
        "task_route_revision": state["task_route_revision"],
        "input_revision": state["input_revision"],
        "implementation_authorization": authorization,
    }


def _direct_pointer(root: Path, task_path: str | None = None) -> tuple[str, str | None]:
    active = resolve_active_task(root)
    if not active.context_key or active.source_type == "session-fallback" or active.stale:
        raise ContinuityError("TASK_TRANSFER_WITHHELD", "a direct, unambiguous session identity is required")
    if task_path is not None and active.task_path != task_path:
        raise ContinuityError("TASK_TRANSFER_WITHHELD", "task is not current in this direct session")
    return active.context_key, active.task_path


def _load_owner(path: Path) -> dict | None:
    record, _ = _read_record(path)
    if record is None:
        return None
    required = {"schema_version", "task_id", "task_path", "package_id", "package_digest", "generation", "status", "source_session_id", "target_session_id", "continuity_digest", "route"}
    if not required.issubset(record) or set(record) - required - {"target_continuity_digest", "recovery_history"} or record.get("schema_version") != 1 or not isinstance(record.get("generation"), int):
        raise ContinuityError("TASK_TRANSFER_WITHHELD", "ownership record has an invalid shape")
    if "target_continuity_digest" in record and (not isinstance(record["target_continuity_digest"], str) or not PACKAGE_DIGEST_RE.fullmatch(record["target_continuity_digest"])):
        raise ContinuityError("TASK_TRANSFER_WITHHELD", "target continuity digest is invalid")
    return record


def _current_projection_digest(root: Path, task_dir: Path, data: dict, task_id: str) -> str:
    return _digest(_projection(root, task_dir, data, task_id))


def transfer_task_ownership(args: argparse.Namespace) -> int:
    root = get_repo_root()
    operation = args.transfer_action
    try:
        package_bound = args.package_id is not None or args.package_digest is not None
        if operation != "status" or package_bound:
            if not isinstance(args.package_id, str) or not PACKAGE_ID_RE.fullmatch(args.package_id) or not isinstance(args.package_digest, str) or not PACKAGE_DIGEST_RE.fullmatch(args.package_digest):
                raise ContinuityError("TASK_TRANSFER_INVALID_INPUT", "session package identity and SHA-256 digest are required")
        task_dir = resolve_task_dir(args.task_path, root)
        if task_dir is None or not is_within_tasks_dir(task_dir, root):
            raise ContinuityError("TASK_TRANSFER_WITHHELD", "task path is unavailable or unsafe")
        task_path = task_dir.relative_to(root).as_posix()
        data, reason = read_json_checked(task_dir / FILE_TASK_JSON)
        if data is None:
            raise ContinuityError("TASK_TRANSFER_WITHHELD", f"task record cannot be read: {reason}")
        task_id = data.get("id") or data.get("name")
        if not isinstance(task_id, str) or task_id != args.task_id:
            raise ContinuityError("TASK_TRANSFER_WITHHELD", "task identity does not match the requested task")
        if operation != "status" and data.get("status") in {"completed", "cancelled"}:
            raise ContinuityError("TASK_TRANSFER_WITHHELD", "terminal tasks cannot change ownership")
        path = _ownership_path(root, task_path)
        with _record_lock(path):
            record = _load_owner(path)
            if record and (record["task_id"] != task_id or record["task_path"] != task_path):
                raise ContinuityError("TASK_TRANSFER_WITHHELD", "ownership record does not match the requested task")
            if operation == "status":
                if record and package_bound and (record["package_id"] != args.package_id or record["package_digest"] != args.package_digest):
                    raise ContinuityError("TASK_TRANSFER_STALE_PACKAGE", "session package identity or digest changed")
                result = record or {"status": "absent", "generation": 0, "task_id": task_id}
                if args.include_current:
                    current = _projection(root, task_dir, data, task_id)
                    result = {**result, "current_continuity_digest": _digest(current), "current_projection": current}
                print(json.dumps(result, ensure_ascii=False, sort_keys=True))
                return 0
            if not args.explicit_user_request:
                raise ContinuityError("TASK_TRANSFER_NOT_AUTHORIZED", "ownership changes require an explicit user request")
            if args.expected_generation is None or args.expected_generation < 0:
                raise ContinuityError("TASK_TRANSFER_INVALID_INPUT", "a non-negative expected generation is required")
            if operation == "quiesce":
                context_key, current_path = _direct_pointer(root, task_path)
                if current_path is None:
                    raise ContinuityError("TASK_TRANSFER_WITHHELD", "source session has no current task")
                continuity_digest = _current_projection_digest(root, task_dir, data, task_id)
                if args.expected_continuity_digest is not None:
                    if not PACKAGE_DIGEST_RE.fullmatch(args.expected_continuity_digest):
                        raise ContinuityError("TASK_TRANSFER_INVALID_INPUT", "expected continuity digest must be a SHA-256 digest")
                    if continuity_digest != args.expected_continuity_digest:
                        raise ContinuityError("TASK_TRANSFER_STALE_CONTINUITY", "current task projection differs from the package snapshot")
                if record is not None:
                    if record["status"] == "quiescing" and record["generation"] == args.expected_generation + 1 and record["source_session_id"] == context_key and record["package_id"] == args.package_id and record["package_digest"] == args.package_digest:
                        if record["continuity_digest"] != continuity_digest:
                            raise ContinuityError("TASK_TRANSFER_STALE_CONTINUITY", "task continuity changed during ownership transfer")
                        result = record
                        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
                        return 0
                    if record["status"] != "consumed" or record["generation"] != args.expected_generation:
                        raise ContinuityError("TASK_TRANSFER_STALE_GENERATION", "task already has an ownership record at a different state or generation")
                    if record["target_session_id"] != context_key:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "only the consumed target can start another handoff")
                    if record["package_id"] == args.package_id:
                        raise ContinuityError("TASK_TRANSFER_STALE_PACKAGE", "another handoff requires a new session package")
                elif args.expected_generation != 0:
                    raise ContinuityError("TASK_TRANSFER_STALE_GENERATION", "initial ownership generation must be 0")
                record = {
                    "schema_version": 1, "task_id": task_id, "task_path": task_path,
                    "package_id": args.package_id, "package_digest": args.package_digest,
                    "generation": args.expected_generation + 1, "status": "quiescing", "source_session_id": context_key,
                    "target_session_id": None, "continuity_digest": continuity_digest,
                    "route": _route_snapshot(data),
                }
            else:
                if record is None:
                    raise ContinuityError("TASK_TRANSFER_ABSENT", "ownership transfer has not started")
                if args.package_id != record["package_id"] or args.package_digest != record["package_digest"]:
                    raise ContinuityError("TASK_TRANSFER_STALE_PACKAGE", "session package identity or digest changed")
                if args.expected_generation != record["generation"]:
                    raise ContinuityError("TASK_TRANSFER_STALE_GENERATION", f"expected generation {args.expected_generation}, current generation is {record['generation']}")
                current_digest = (
                    _current_projection_digest(root, task_dir, data, task_id)
                    if operation != "release" else record["continuity_digest"]
                )
                if args.expected_continuity_digest is not None:
                    if not PACKAGE_DIGEST_RE.fullmatch(args.expected_continuity_digest):
                        raise ContinuityError("TASK_TRANSFER_INVALID_INPUT", "expected continuity digest must be a SHA-256 digest")
                    if args.expected_continuity_digest != current_digest:
                        raise ContinuityError("TASK_TRANSFER_STALE_CONTINUITY", "current task projection differs from the explicitly checked snapshot")
                # Recovery acknowledges a live target snapshot without rebasing the source package.
                recovered_claim = (
                    operation == "claim" and record["status"] == "sealed"
                    and args.expected_continuity_digest == current_digest
                )
                if operation not in {"release", "recover"} and current_digest != record.get("target_continuity_digest", record["continuity_digest"]) and not recovered_claim:
                    raise ContinuityError("TASK_TRANSFER_STALE_CONTINUITY", "task continuity changed during ownership transfer")
                if operation != "release" and _route_snapshot(data) != record["route"]:
                    raise ContinuityError("TASK_TRANSFER_STALE_ROUTE", "task phase, route, input, or implementation authorization changed")
                context_key, current_path = _direct_pointer(root)
                if operation == "recover":
                    if record["status"] not in {"claiming", "claimed", "recovery_required"} or not isinstance(args.reason, str) or not args.reason.strip() or args.expected_continuity_digest != current_digest:
                        raise ContinuityError("TASK_TRANSFER_INVALID_TRANSITION", "explicit recovery requires a pending target, a reason, and the current projection digest")
                    if current_path not in {None, record["task_path"]}:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "recovery session already has another active task")
                    from .task_workflow import _assert_delegated_resources_closed
                    try:
                        _assert_delegated_resources_closed(task_dir, data)
                    except TaskWorkflowError as error:
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", str(error)) from error
                    teammates_dir = task_dir / "teammates"
                    if any(teammates_dir.rglob("queue.json")) or any(teammates_dir.rglob("claim.json")):
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "managed teamwork runtime artifacts remain; reconcile the original batch first")
                    record.setdefault("recovery_history", []).append({"generation": record["generation"], "status": record["status"], "target_session_id": record["target_session_id"], "requested_by": context_key, "reason": args.reason})
                    record.update({"status": "recovery_required", "generation": record["generation"] + 1, "target_continuity_digest": current_digest})
                    if not write_json(path, record):
                        raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not fence the previous generation before recovery")
                    for session in {record["source_session_id"], record["target_session_id"]} - {None}:
                        if not clear_active_task_if_matches(root, session, record["task_path"]):
                            raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "a prior session pointer changed; preserve the current generation")
                    record.update({"status": "ready", "target_session_id": None})
                    if not write_json(path, record):
                        raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not persist explicit recovery")
                    print(json.dumps(record, ensure_ascii=False, sort_keys=True))
                    return 0
                if operation in {"seal", "retire"}:
                    if context_key != record["source_session_id"] or current_path not in {record["task_path"], None}:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "source session no longer owns the current task")
                elif operation in {"claim", "consume"}:
                    if context_key == record["source_session_id"]:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "target must be a different direct session")
                if operation == "release":
                    if record["status"] not in {"quiescing", "sealed", "recovery_required"} or record["target_session_id"] is not None:
                        raise ContinuityError("TASK_TRANSFER_INVALID_TRANSITION", "ownership can be released only before target claim")
                    if context_key != record["source_session_id"] or current_path not in {None, record["task_path"]}:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "only the source session can release this transfer")
                    if current_path is None and not compare_and_set_active_task(root, context_key, None, record["task_path"]):
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "source task pointer could not be restored")
                    active = resolve_active_task(root)
                    if active.task_path != record["task_path"] or active.context_key != context_key:
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "source task pointer restoration could not be verified")
                    path.unlink(missing_ok=True)
                    print(json.dumps({"status": "released", "generation": record["generation"], "task_id": task_id}, ensure_ascii=False, sort_keys=True))
                    return 0
                if operation == "seal" and record["status"] == "quiescing":
                    record.update({"status": "sealed", "generation": record["generation"] + 1})
                elif operation == "retire" and record["status"] in {"sealed", "retiring", "recovery_required"}:
                    if record["status"] == "sealed":
                        record.update({"status": "retiring", "generation": record["generation"] + 1})
                        if not write_json(path, record):
                            raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not record source retirement")
                    if current_path is not None and not compare_and_set_active_task(root, context_key, record["task_path"], None):
                        record["status"] = "recovery_required"
                        write_json(path, record)
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "source pointer changed during retirement")
                    if resolve_active_task(root).task_path is not None:
                        record["status"] = "recovery_required"
                        write_json(path, record)
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "source pointer remains after retirement")
                    record["status"] = "ready"
                elif operation == "claim" and (record["status"] in {"ready", "claiming", "recovery_required", "claimed"} or recovered_claim):
                    if record["status"] in {"claiming", "recovery_required"} and record["target_session_id"] != context_key:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "only the recorded target session can recover a claim")
                    if current_path not in {None, record["task_path"]}:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "target session already has a current task")
                    if record["status"] in {"ready", "sealed"}:
                        record.update({"status": "claiming", "generation": record["generation"] + 1, "target_session_id": context_key})
                        if recovered_claim:
                            record["target_continuity_digest"] = current_digest
                        if not write_json(path, record):
                            raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not record target claim")
                    elif record["status"] == "claimed":
                        previous_target = record["target_session_id"]
                        if previous_target == context_key:
                            raise ContinuityError("TASK_TRANSFER_INVALID_TRANSITION", "the current target must consume ownership instead of claiming it again")
                        if previous_target is not None and not clear_active_task_if_matches(root, previous_target, record["task_path"]):
                            raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "previous target pointer could not be cleared")
                        record.update({"status": "claiming", "generation": record["generation"] + 1, "target_session_id": context_key})
                        if not write_json(path, record):
                            raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not record target takeover")
                    if not clear_active_task_if_matches(root, record["source_session_id"], record["task_path"]):
                        record["status"] = "recovery_required"
                        write_json(path, record)
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "source pointer could not be retired during claim")
                    if current_path is None and not compare_and_set_active_task(root, context_key, None, record["task_path"]):
                        record["status"] = "recovery_required"
                        write_json(path, record)
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "target pointer could not be claimed")
                    active = resolve_active_task(root)
                    if active.task_path != record["task_path"] or active.context_key != context_key:
                        record["status"] = "recovery_required"
                        write_json(path, record)
                        raise ContinuityError("TASK_TRANSFER_RECOVERY_REQUIRED", "target pointer verification failed")
                    record["status"] = "claimed"
                elif operation == "consume" and record["status"] == "claimed":
                    if context_key != record["target_session_id"] or current_path != record["task_path"]:
                        raise ContinuityError("TASK_TRANSFER_WITHHELD", "only the direct target session can consume the task")
                    record.update({"status": "consumed", "generation": record["generation"] + 1})
                else:
                    raise ContinuityError("TASK_TRANSFER_INVALID_TRANSITION", f"cannot apply {operation} while ownership is {record['status']}")
            if not write_json(path, record):
                raise ContinuityError("TASK_TRANSFER_WRITE_FAILED", "could not atomically update ownership record")
        print(json.dumps(record, ensure_ascii=False, sort_keys=True))
        return 0
    except ContinuityError as error:
        print(json.dumps({"status": "withheld", "code": error.code, "reason": str(error)}, ensure_ascii=False))
        return 1


def add_continuity_commands(subparsers) -> None:
    continuity = subparsers.add_parser("continuity", help="Read or capture current task continuity")
    continuity_sub = continuity.add_subparsers(dest="continuity_action", required=True)
    continuity_sub.add_parser("show", help="Recompute current continuity status")
    capture = continuity_sub.add_parser("capture", help="Capture the current task projection with compare-and-set")
    capture.add_argument("--expected-source-digest", required=True, help="Current captured digest, or absent")

    transfer = subparsers.add_parser("transfer", help="Transfer task ownership between direct sessions")
    transfer.add_argument("transfer_action", choices=("status", "quiesce", "seal", "retire", "claim", "consume", "release", "recover"))
    transfer.add_argument("--reason", help="Explicit recovery reason")
    transfer.add_argument("--task-id", required=True)
    transfer.add_argument("--task-path", required=True)
    transfer.add_argument("--package-id", help="Required with --package-digest for mutations or package-bound status")
    transfer.add_argument("--package-digest", help="Required with --package-id for mutations or package-bound status")
    transfer.add_argument("--expected-continuity-digest", help="Expected live projection for sealed-source claim recovery")
    transfer.add_argument("--expected-generation", type=int)
    transfer.add_argument("--include-current", action="store_true", help="Include the live task projection and its digest in transfer status")
    transfer.add_argument("--explicit-user-request", action="store_true")


def clear_task_runtime_records(repo_root: Path, task_path: str) -> bool:
    """Remove only this task's current continuity and ownership projections."""
    for path in (_continuity_path(repo_root, task_path), _ownership_path(repo_root, task_path)):
        if not path.exists():
            continue
        with _record_lock(path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                return False
    return True


@contextlib.contextmanager
def active_task_change_guard(repo_root: Path, context_key: str, task_path: str, *, clearing: bool):
    """Serialize pointer writes with ownership changes for the same task."""
    from .task_move import layout_lock, require_settled_layout

    with layout_lock(repo_root):
        require_settled_layout(repo_root)
        directory = resolve_task_dir(task_path, repo_root)
        if directory is None:
            yield False
            return
        task_path = directory.relative_to(repo_root).as_posix()
        path = _ownership_path(repo_root, task_path)
        with _record_lock(path):
            try:
                record = _load_owner(path)
            except ContinuityError:
                yield False
                return
            if record is None:
                yield True
                return
            data, _ = read_json_checked(directory / FILE_TASK_JSON)
            task_id = (data.get("id") or data.get("name")) if isinstance(data, dict) else None
            if task_id != record["task_id"] or record["task_path"] != task_path:
                yield False
                return
            if clearing:
                allowed = record["status"] == "consumed" and record["target_session_id"] == context_key
            elif record["status"] == "ready":
                allowed = context_key != record["source_session_id"] and task_path == record["task_path"]
            elif record["status"] == "consumed":
                allowed = context_key == record["target_session_id"] and task_path == record["task_path"]
            else:
                allowed = record["status"] in {"claiming", "claimed"} and context_key == record["target_session_id"] and task_path == record["task_path"]
            yield allowed


def assert_task_mutation_allowed(repo_root: Path, task_dir: Path, data: dict) -> None:
    """Reject task writes until ownership is consumed or the source releases it."""
    with task_mutation_guard(repo_root, task_dir, data) as allowed:
        if not allowed:
            raise TaskWorkflowError("TASK_TRANSFER_ACTIVE", "task changes are fenced until the target session consumes ownership or the source releases the transfer")


def assert_task_identity_change_allowed(repo_root: Path, task_dir: Path, data: dict) -> None:
    """Keep an active ownership record addressable while the task ID is fixed."""
    task_path = task_dir.relative_to(repo_root).as_posix()
    path = _ownership_path(repo_root, task_path)
    with _record_lock(path):
        try:
            record = _load_owner(path)
        except ContinuityError as error:
            raise TaskWorkflowError(error.code, str(error)) from error
        if record is not None:
            raise TaskWorkflowError("TASK_TRANSFER_TASK_ID_LOCKED", "task ID cannot change while its ownership record is active")


@contextlib.contextmanager
def task_mutation_guard(repo_root: Path, task_dir: Path, data: dict):
    """Hold the ownership lock across a single task mutation."""
    from .task_move import layout_lock, require_settled_layout

    with layout_lock(repo_root):
        require_settled_layout(repo_root)
        task_path = task_dir.relative_to(repo_root).as_posix()
        path = _ownership_path(repo_root, task_path)
        with _record_lock(path):
            try:
                record = _load_owner(path)
            except ContinuityError:
                yield False
                return
            if record is None:
                yield True
                return
            task_id = (data.get("id") or data.get("name")) if isinstance(data, dict) else None
            if task_id != record["task_id"] or record["task_path"] != task_path:
                yield False
                return
            active = resolve_active_task(repo_root)
            allowed = record["status"] == "consumed" and active.context_key == record["target_session_id"] and active.task_path == task_path
            yield allowed
