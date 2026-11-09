"""Recoverable task relocation shared by lifecycle commands and explicit migration."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import sys
from pathlib import Path

from .io import read_json_checked, write_json, write_text_atomic
from .paths import get_repo_root, get_tasks_dir
from .task_layout import MONTH_RE, iter_task_dirs, task_location, task_status_dir

_LOCK_DEPTH = 0
_APPLYING = False


def journal_path(root: Path) -> Path:
    return root / ".trellis/.runtime/task-layout-transaction.json"


def require_settled_layout(root: Path) -> None:
    if not _APPLYING and journal_path(root).exists():
        raise ValueError("Task relocation requires recovery: run task.py migrate-layout --recover")


@contextlib.contextmanager
def layout_lock(root: Path):
    # Reentrant within one process; all task/pointer writers take this before record locks.
    global _LOCK_DEPTH
    from .task_continuity import _record_lock

    if _LOCK_DEPTH:
        _LOCK_DEPTH += 1
        try:
            yield
        finally:
            _LOCK_DEPTH -= 1
        return
    with _record_lock(root / ".trellis/.runtime/task-layout.json"):
        _LOCK_DEPTH = 1
        try:
            yield
        finally:
            _LOCK_DEPTH = 0


def _read(path: Path) -> dict:
    data, reason = read_json_checked(path)
    if data is None:
        raise ValueError(f"Cannot read {path}: {reason}")
    return data


def _json(data: object) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _rewrite(value, mapping: dict[str, str]):
    if isinstance(value, str):
        for old, new in mapping.items():
            if value == old or value.startswith(old + "/"):
                return new + value[len(old):]
        return value
    if isinstance(value, list):
        return [_rewrite(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite(item, mapping) for key, item in value.items()}
    return value


def _safe_path(root: Path, relative: str) -> Path:
    path = root / relative
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"Unsafe relocation path: {relative}")
    # The tasks root may itself be shared; descendants must never be symlinks.
    allowed = get_tasks_dir(root) if Path(relative).parts[:2] == (".trellis", "tasks") else root / ".trellis"
    path.resolve().relative_to(allowed.resolve())
    current = root / ".trellis"
    for part in Path(relative).parts[1:]:
        current /= part
        if current != get_tasks_dir(root) and current.is_symlink():
            raise ValueError(f"Symlink in relocation input: {current}")
    return path


def _plan(root: Path, moves: list[tuple[Path, Path]], updates: dict[Path, dict]) -> dict:
    from .active_task import resolve_active_task
    from .task_continuity import _load_owner, _ownership_path

    mapping = {old.relative_to(root).as_posix(): new.relative_to(root).as_posix() for old, new in moves if old != new}
    rewrites = {**mapping, **{str(root / old): str(root / new) for old, new in mapping.items()}}
    destinations = list(mapping.values())
    if len(set(destinations)) != len(destinations):
        raise ValueError("Two tasks have the same destination; nothing moved")
    for old, new in mapping.items():
        source, target = _safe_path(root, old), _safe_path(root, new)
        if not source.is_dir() or target.exists():
            raise ValueError(f"Missing source or destination conflict: {old} -> {new}")
        for path in source.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Symlink in task content: {path}")
            if path.is_file():
                path.read_bytes()
            elif not path.is_dir():
                raise ValueError(f"Unsupported task content: {path}")
        data = _read(source / "task.json")
        from .worktree_delegation import resolve_record
        delegated = resolve_record(root, source, data)
        if delegated is not None:
            from .task_workflow import _assert_delegated_record_closed
            _assert_delegated_record_closed(source.name, delegated)
        owner = _load_owner(_ownership_path(root, old))
        if owner:
            active = resolve_active_task(root)
            if owner["task_id"] != (data.get("id") or data.get("name")) or owner["task_path"] != old or owner["status"] != "consumed" or active.context_key != owner["target_session_id"] or active.task_path != old:
                raise ValueError(f"Task ownership prevents relocation: {old}")

    before: dict[str, str | None] = {}
    after: dict[str, str | None] = {}

    def change(path: Path, text: str | None):
        relative = path.relative_to(root).as_posix()
        _safe_path(root, relative)
        original = path.read_text(encoding="utf-8") if path.exists() else None
        if original != text:
            before[relative], after[relative] = original, text

    directories = iter_task_dirs(get_tasks_dir(root), legacy=True) if mapping else iter(updates)
    for directory in directories:
        data = updates.get(directory, _read(directory / "task.json"))
        replacement = _rewrite(data, rewrites)
        if directory in updates or replacement != data:
            change(directory / "task.json", _json(replacement))
        for path in sorted(directory.glob("*.jsonl")):
            lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
            changed = False
            for index, line in enumerate(lines):
                if not line.strip():
                    continue
                record = json.loads(line)
                updated = _rewrite(record, rewrites)
                if updated != record:
                    lines[index] = json.dumps(updated, ensure_ascii=False) + "\n"
                    changed = True
            if changed:
                change(path, "".join(lines))

    runtime = root / ".trellis/.runtime"
    terminal = {directory.relative_to(root).as_posix() for directory, data in updates.items()
                if data.get("status") in {"completed", "cancelled"}}
    terminal_hashes = {hashlib.sha256(ref.encode()).hexdigest() for ref in terminal}
    terminal_refs = terminal | {str(root / ref) for ref in terminal}
    for folder in ("sessions", "continuity", "task-ownership"):
        for path in sorted((runtime / folder).glob("*.json")):
            record = _read(path)
            if (folder == "sessions" and record.get("current_task") in terminal_refs) or (
                folder != "sessions" and path.stem in terminal_hashes
            ):
                change(path, None)
                continue
            updated = _rewrite(record, rewrites)
            target = path
            if folder != "sessions":
                for old, new in mapping.items():
                    if path.stem == hashlib.sha256(old.encode()).hexdigest():
                        target = path.with_name(hashlib.sha256(new.encode()).hexdigest() + ".json")
                        if target.exists():
                            raise ValueError(f"Runtime destination conflict: {target}")
                        break
            if target != path:
                change(path, None)
                change(target, _json(updated))
            elif updated != record:
                change(path, _json(updated))
    return {"schema_version": 1, "state": "pending", "moves": mapping, "before": before, "after": after}


def _write(path: Path, text: str | None) -> None:
    if text is None:
        path.unlink(missing_ok=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_atomic(path, text):
            raise OSError(f"Cannot write {path}")


def recover_layout(root: Path) -> None:
    path = _safe_path(root, journal_path(root).relative_to(root).as_posix())
    if not path.exists():
        return
    journal = _read(path)
    if journal.get("schema_version") != 1 or journal.get("state") not in {"pending", "committed"}:
        raise ValueError("Invalid task relocation recovery record")
    if not all(isinstance(journal.get(key), dict) for key in ("moves", "before", "after")) or set(journal["before"]) != set(journal["after"]):
        raise ValueError("Invalid task relocation recovery inputs")
    def task_path(relative):
        if not isinstance(relative, str):
            raise ValueError("Invalid recovery task path")
        candidate = _safe_path(root, relative)
        parts = candidate.relative_to(get_tasks_dir(root)).parts
        if not (len(parts) == 1 or task_status_dir(candidate, get_tasks_dir(root)) or (
            len(parts) == 3 and parts[0] == "archive" and MONTH_RE.fullmatch(parts[1])
        )):
            raise ValueError(f"Invalid recovery task directory: {relative}")
        task_location(get_tasks_dir(root), candidate.name, "planning")
        return candidate

    if not all(isinstance(old, str) and isinstance(new, str) for old, new in journal["moves"].items()):
        raise ValueError("Invalid recovery moves")
    sources, targets = set(journal["moves"]), set(journal["moves"].values())
    if len(targets) != len(journal["moves"]) or sources & targets:
        raise ValueError("Conflicting recovery moves")
    for old, new in journal["moves"].items():
        task_path(old)
        if not task_status_dir(task_path(new), get_tasks_dir(root)):
            raise ValueError(f"Invalid recovery destination: {new}")
    for relative, original in journal["before"].items():
        if not isinstance(relative, str) or any(value is not None and not isinstance(value, str)
                for value in (original, journal["after"][relative])):
            raise ValueError("Invalid recovery file input")
        candidate = _safe_path(root, relative)
        parts = Path(relative).parts
        if parts[:2] == (".trellis", "tasks"):
            task_path(candidate.parent.relative_to(root).as_posix())
            if candidate.name != "task.json" and candidate.suffix != ".jsonl":
                raise ValueError(f"Invalid recovery task file: {relative}")
        elif not (len(parts) == 4 and parts[:2] == (".trellis", ".runtime")
                  and parts[2] in {"sessions", "continuity", "task-ownership"} and candidate.suffix == ".json"):
            raise ValueError(f"Recovery file is outside the task transaction: {relative}")
    if journal["state"] == "pending":
        moved = {}
        for old, new in journal["moves"].items():
            source, target = root / old, root / new
            if source.is_dir() == target.is_dir():
                raise ValueError(f"Recovery conflict: {old} / {new}; preserve both for inspection")
            if target.exists():
                moved[old] = new
        for relative, original in journal["before"].items():
            current_relative = _rewrite(relative, moved)
            if not isinstance(current_relative, str):
                raise ValueError("Invalid recovery file path")
            current_path = root / current_relative
            current = current_path.read_text(encoding="utf-8") if current_path.exists() else None
            if current not in (original, journal["after"][relative]):
                raise ValueError(f"Recovery input changed: {relative}; no overwrite")
        for old, new in reversed(list(moved.items())):
            source = root / old
            source.parent.mkdir(parents=True, exist_ok=True)
            (root / new).rename(source)
        for relative, original in journal["before"].items():
            _write(root / relative, original)
    path.unlink()


def apply_plan(root: Path, plan: dict) -> None:
    global _APPLYING
    require_settled_layout(root)
    if not plan["moves"] and not plan["before"]:
        return
    transaction = _safe_path(root, journal_path(root).relative_to(root).as_posix())
    transaction.parent.mkdir(parents=True, exist_ok=True)
    if not write_json(transaction, plan):
        raise OSError("Cannot save task relocation recovery record")
    _APPLYING = True
    try:
        for relative, text in plan["after"].items():
            _write(root / relative, text)
        for old, new in plan["moves"].items():
            target = root / new
            target.parent.mkdir(parents=True, exist_ok=True)
            (root / old).rename(target)
        plan["state"] = "committed"
        if not write_json(journal_path(root), plan):
            raise OSError("Cannot commit task relocation")
        journal_path(root).unlink()
    except BaseException:
        recover_layout(root)
        raise
    finally:
        _APPLYING = False
    archive = get_tasks_dir(root) / "archive"
    if archive.is_dir():
        for month in sorted(archive.iterdir()):
            if month.is_dir() and not any(month.iterdir()):
                month.rmdir()
        if not any(archive.iterdir()):
            archive.rmdir()


def relocate_task(root: Path, directory: Path, data: dict) -> Path:
    """Change lifecycle status and location together; do not grant workflow authorization."""
    destination = task_location(get_tasks_dir(root), directory.name, data["status"])
    if data["status"] == "completed" and task_status_dir(directory, get_tasks_dir(root)) == "completed":
        destination = directory
    with layout_lock(root):
        require_settled_layout(root)
        plan = _plan(root, [(directory, destination)], {directory: data})
        apply_plan(root, plan)
    return destination


def cmd_migrate_layout(args: argparse.Namespace) -> int:
    root = get_repo_root()
    try:
        with layout_lock(root):
            if args.recover:
                recover_layout(root)
                print(json.dumps({"status": "recovered"}))
                return 0
            require_settled_layout(root)
            tasks = get_tasks_dir(root)
            moves: list[tuple[Path, Path]] = []
            names: set[str] = set()
            for directory in iter_task_dirs(tasks, legacy=True):
                data = _read(directory / "task.json")
                if directory.name in names:
                    raise ValueError(f"Duplicate task directory name: {directory.name}")
                names.add(directory.name)
                status = data.get("status")
                if not isinstance(status, str):
                    raise ValueError(f"Task status is missing: {directory}")
                month = None
                if status == "completed":
                    relative = directory.relative_to(tasks).parts
                    if len(relative) == 3 and relative[0] in {"archive", "completed"} and MONTH_RE.fullmatch(relative[1]):
                        month = relative[1]
                    elif isinstance(data.get("completedAt"), str) and MONTH_RE.fullmatch(data["completedAt"][:7]):
                        month = data["completedAt"][:7]
                    else:
                        raise ValueError(f"Completion month is missing: {directory}")
                target = task_location(tasks, directory.name, status, month)
                if directory != target:
                    moves.append((directory, target))
            plan = _plan(root, moves, {})
            result = {"status": "applied" if args.apply else "preview", "moves": plan["moves"], "changed_files": sorted(plan["before"])}
            if args.apply:
                apply_plan(root, plan)
            print(json.dumps(result, ensure_ascii=False))
            return 0
    except (ValueError, OSError, RuntimeError) as error:
        print(f"TASK_LAYOUT_WITHHELD: {error}", file=sys.stderr)
        return 1
