"""Bounded retirement of Trellis-owned projections; never task evidence."""

from __future__ import annotations

import argparse
import ast
import hashlib
from itertools import islice
import json
import os
from pathlib import Path
import re
import stat
import sys

from .io import read_json_checked
from .paths import get_repo_root
from .task_move import layout_lock, require_settled_layout
from .task_utils import is_within_tasks_dir, resolve_task_dir

MAX_FILES = 2048
MAX_BYTES = 256 * 1024
SESSION_KEYS = {"current_task", "current_run", "platform", "last_seen_at"}
MARKER = re.compile(r"update-check-[A-Za-z0-9_.-]+\.marker\Z")


def _fingerprint(path: Path) -> dict:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
        raise ValueError("not a bounded regular file")
    return {"device": info.st_dev, "inode": info.st_ino, "size": info.st_size,
            "mtime_ns": info.st_mtime_ns, "mode": info.st_mode,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _protocol(root: Path) -> dict:
    """Check the materialized writers, not merely the executing CLI version."""
    scripts = root / ".trellis/scripts"
    result = {}
    checks = {"common/active_task.py": "_session_file_lock",
              "common/task_workflow.py": "_task_lock",
              "common/task_continuity.py": "continuity_capture",
              "task.py": "main"}
    for relative, function in checks.items():
        path = scripts / relative
        try:
            if path.resolve() != path.absolute():
                return {"ready": False, "reason": "redirected native writer"}
            raw = path.read_bytes()
            tree = ast.parse(raw)
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == function)
            calls = {n.func.id for n in ast.walk(node)
                     if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
            if "layout_lock" not in calls:
                return {"ready": False, "reason": "native writers still use the old protocol"}
            if relative == "common/task_continuity.py" and any(
                isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_record_lock"
                for n in ast.walk(tree)
            ):
                return {"ready": False, "reason": "per-record continuity writer remains"}
            result[relative] = hashlib.sha256(raw).hexdigest()
        except (OSError, SyntaxError, StopIteration, ValueError):
            return {"ready": False, "reason": "cannot verify materialized native writers"}
    return {"ready": True, "writers": result}


def _open_anchors(identities: set[tuple[int, int]]) -> tuple[set[tuple[int, int]], str | None]:
    # Open descriptors include flock waiters; an empty /proc/locks snapshot does not.
    if not identities:
        return set(), None
    if sys.platform != "linux":
        return set(), "legacy anchor retirement requires descriptor verification on this platform"
    opened: set[tuple[int, int]] = set()
    inspected = 0
    try:
        processes = list(Path("/proc").iterdir())
        if len(processes) > 8192:
            return opened, "process inspection limit exceeded"
        for process in processes:
            if not process.name.isdigit():
                continue
            try:
                if process.stat().st_uid != os.getuid():
                    continue
                for descriptor in (process / "fd").iterdir():
                    inspected += 1
                    if inspected > 50000:
                        return opened, "descriptor inspection limit exceeded"
                    try:
                        info = descriptor.stat()
                        identity = (info.st_dev, info.st_ino)
                        if identity in identities:
                            opened.add(identity)
                    except FileNotFoundError:
                        pass
            except FileNotFoundError:
                pass
    except OSError:
        return opened, "cannot completely inspect same-user open descriptors"
    return opened, None


def preview(root: Path, task: str | None = None) -> dict:
    runtime = root / ".trellis/.runtime"
    if runtime.resolve() != runtime.absolute():
        raise ValueError("redirected runtime directory")
    task_dir = resolve_task_dir(task, root) if task else None
    if task and (task_dir is None or not is_within_tasks_dir(task_dir, root)):
        raise ValueError("task scope must resolve to an existing native task")
    task_path = task_dir.relative_to(root).as_posix() if task_dir else None
    task_key = hashlib.sha256(task_path.encode()).hexdigest() if task_path else None
    protocol = _protocol(root)
    items: list[dict] = []
    for family in ("sessions", "task-phase", "task-ownership", "continuity", ""):
        directory = runtime / family
        if not directory.exists():
            continue
        if directory.resolve() != directory.absolute() or not directory.is_dir():
            raise ValueError("redirected or invalid runtime family")
        paths = list(islice(directory.iterdir(), MAX_FILES + 1))
        if len(paths) > MAX_FILES:
            raise ValueError("runtime family scan limit exceeded; nothing may be removed")
        for path in sorted(paths):
            if family == "" and (task or not MARKER.fullmatch(path.name)):
                continue
            if family and path.suffix not in {".json", ".lock"}:
                continue
            if task_dir and not (family == "task-phase" and path.stem == task_dir.name or
                                 family in {"continuity", "task-ownership"} and path.stem == task_key):
                continue
            if len(items) >= MAX_FILES:
                raise ValueError("runtime preview limit exceeded; nothing may be removed")
            item = {"path": path.relative_to(root).as_posix(), "family": family or "update-hint",
                    "eligible": False, "reason": "business record or unknown content"}
            try:
                fingerprint = _fingerprint(path)
                item["fingerprint"] = fingerprint
                if path.suffix == ".lock":
                    item["role"] = "retired-anchor"
                    if family in {"continuity", "task-ownership"}:
                        pattern = r"[0-9a-f]{64}"
                    elif family == "task-phase":
                        pattern = r"\d{2}-\d{2}-[A-Za-z0-9_.-]+"
                    else:
                        pattern = r"[A-Za-z0-9_.-]{1,128}"
                    known_name = bool(re.fullmatch(pattern, path.stem))
                    item["eligible"] = known_name and protocol["ready"] and path.read_bytes() in {b"", b"\0"}
                    item["reason"] = "native writers use the fixed layout anchor" if item["eligible"] else "writer protocol or anchor content is not verified"
                elif family == "":
                    item["role"] = "obsolete-update-hint"
                    item["eligible"] = protocol["ready"] and path.read_bytes() == b"checked\n"
                    item["reason"] = "replaced by one version-pair record" if item["eligible"] else "unknown marker or old writer protocol"
                elif family == "sessions":
                    data, _ = read_json_checked(path)
                    item["role"] = "session-projection"
                    item["eligible"] = (
                        data is not None and set(data) <= SESSION_KEYS
                        and data.get("current_task") in (None, "") and data.get("current_run") is None
                        and all(data.get(key) is None or isinstance(data[key], str) for key in ("platform", "last_seen_at"))
                    )
                    item["reason"] = "known empty business projection" if item["eligible"] else "task, run, unknown field or invalid record is retained"
                else:
                    item["role"] = "control-evidence"
            except (OSError, ValueError):
                item["reason"] = "unreadable, redirected, nonregular or oversized object"
            items.append(item)
    anchors = {(i["fingerprint"]["device"], i["fingerprint"]["inode"])
               for i in items if i.get("role") == "retired-anchor" and i["eligible"]}
    opened, error = _open_anchors(anchors)
    for item in items:
        if item.get("role") != "retired-anchor" or not item["eligible"]:
            continue
        info = item["fingerprint"]
        if error or (info["device"], info["inode"]) in opened:
            item.update(eligible=False, reason=error or "an existing writer or waiter has the anchor open")
    result = {"owner": "trellis-task", "scope": task_path or "project-runtime",
              "writer_protocol": protocol, "items": items}
    result["digest"] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return result


def cmd_runtime(args: argparse.Namespace) -> int:
    root = get_repo_root()
    with layout_lock(root):
        require_settled_layout(root)
        result = preview(root, args.dir)
        result["dry_run"] = not bool(args.confirm)
        result["removed"] = []
        result["failed"] = []
        if args.confirm:
            if args.confirm != result["digest"]:
                print(json.dumps({"status": "stale", "preview": result}, ensure_ascii=False))
                return 1
            for item in result["items"]:
                if not item["eligible"]:
                    continue
                path = root / item["path"]
                try:
                    if _fingerprint(path) != item["fingerprint"]:
                        raise ValueError("object changed after confirmation")
                    if item["role"] == "retired-anchor":
                        info = item["fingerprint"]
                        opened, error = _open_anchors({(info["device"], info["inode"])})
                        if error or opened:
                            raise ValueError(error or "anchor became open")
                    path.unlink()
                    result["removed"].append(item["path"])
                except (OSError, ValueError) as error:
                    result["failed"].append({"path": item["path"], "reason": str(error)})
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 1 if result["failed"] else 0
