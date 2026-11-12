#!/usr/bin/env python3
"""Codex PreToolUse guard for CLI-owned foreground batches.

Only supported host tool hooks are guarded. Ordinary model messages and tools
that the host does not expose to PreToolUse remain Skill obligations.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
import shlex
import stat
import sys
from pathlib import Path


def safe_path(value: str, root: Path) -> Path:
    candidate = Path(os.path.abspath(root / value))
    parts = candidate.relative_to(root).parts
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("symlink in recovery path")
    return candidate


def read_record(file: Path, limit: int) -> dict:
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("invalid recovery file")
    value = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("invalid recovery object")
    return value


def recovery_arguments(command: str) -> tuple[str, str, bool] | None:
    if any(character in command for character in "$`;\n\r&|<>"):
        return None
    argv = shlex.split(command)
    if argv[:3] != ["trellis", "teamwork", "reconcile"] or len(argv) < 6:
        return None
    plan = argv[3]
    options: dict[str, str | bool] = {}
    index = 4
    while index < len(argv):
        name = argv[index]
        if name in options:
            return None
        if name in {"--execute", "--confirm-unknown-process-exit"}:
            options[name] = True
        elif name in {"--task", "--wait", "--reason"} and index + 1 < len(argv):
            index += 1
            options[name] = argv[index]
        else:
            return None
        index += 1
    task = options.get("--task")
    if not isinstance(task, str):
        return None
    if "--wait" in options:
        seconds = options["--wait"]
        if not isinstance(seconds, str) or len(seconds) > 2 or not seconds.isascii() or not seconds.isdecimal() or str(int(seconds)) != seconds or not 1 <= int(seconds) <= 60:
            return None
        if any(name in options for name in {"--execute", "--reason", "--confirm-unknown-process-exit"}):
            return None
    if "--confirm-unknown-process-exit" in options and "--execute" not in options:
        return None
    if "--execute" in options and not str(options.get("--reason", "")).strip():
        return None
    return plan, task, "--execute" not in options


def decision(payload: dict) -> dict | None:
    if not isinstance(payload, dict):
        return None
    if os.environ.get("TRELLIS_HOOKS") == "0":
        return None
    session = payload.get("session_id") or os.environ.get("CODEX_THREAD_ID")
    if not isinstance(session, str) or not session:
        return None
    root = Path(payload.get("cwd") or os.getcwd()).resolve()
    while not (root / ".trellis").is_dir() and root != root.parent:
        root = root.parent
    directory = root / ".trellis/.runtime/teamwork-waits" / hashlib.sha256(session.encode()).hexdigest()
    unsafe_directory = False
    records: list[Path] = []
    try:
        safe_path(str(directory), root)
        if directory.exists():
            records = list(itertools.islice(directory.glob("*.json"), 65))
            if len(records) > 64:
                unsafe_directory = True
                records = []
    except (OSError, ValueError):
        unsafe_directory = True
    if not records and not unsafe_directory:
        return None
    states: list[dict] = []
    hints: list[str] = []
    for record in records:
        try:
            safe_path(str(record), root)
            state = read_record(record, 4096)
            if state.get("schemaVersion") != 1 or state.get("state") != "waiting":
                raise ValueError("unsupported foreground projection")
            session_id, batch_id, plan_hash = (state.get(key) for key in ("sessionId", "batchId", "planHash"))
            if not all(isinstance(value, str) and value for value in (session_id, batch_id, plan_hash)):
                raise ValueError("missing frozen identity")
            if not isinstance(plan_hash, str) or len(plan_hash) != 64 or any(character not in "0123456789abcdef" for character in plan_hash):
                raise ValueError("invalid frozen hash")
            if type(state.get("ownerPid")) is not int or state["ownerPid"] <= 0:
                raise ValueError("invalid owner pid")
            if record.name != hashlib.sha256(f"{session_id}:{batch_id}".encode()).hexdigest() + ".json":
                raise ValueError("projection filename identity mismatch")
            states.append(state)
            if isinstance(state.get("planPath"), str) and isinstance(state.get("taskRoot"), str):
                plan_path = safe_path(state["planPath"], root)
                task_path = safe_path(state["taskRoot"], root)
                hints.append(f"trellis teamwork reconcile {shlex.quote(str(plan_path))} --task {shlex.quote(str(task_path))} --wait 30")
        except (OSError, ValueError, TypeError):
            continue
    tool = str(payload.get("tool_name", "")).rsplit(".", 1)[-1]
    if tool in {"write_stdin", "wait"}:
        return None
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    command = tool_input.get("command", tool_input.get("cmd"))
    if isinstance(command, str):
        try:
            arguments = recovery_arguments(command)
            if arguments:
                plan_path, task_path = (safe_path(value, root) for value in arguments[:2])
                task_path.relative_to(root / ".trellis" / "tasks")
                plan_path.relative_to(task_path)
                plan = read_record(plan_path, 2097152)
                if not task_path.is_dir():
                    raise ValueError("missing owning task")
                if arguments[2] and not unsafe_directory:
                    session_id, batch_id = plan.get("session_id"), plan.get("batch_id")
                    if isinstance(session_id, str) and session_id and isinstance(batch_id, str) and batch_id:
                        expected = hashlib.sha256(f"{session_id}:{batch_id}".encode()).hexdigest() + ".json"
                        if any(record.name == expected for record in records):
                            # Native reconcile independently validates frozen inputs; a corrupt
                            # projection must not prevent read-only diagnosis of that same batch.
                            return None
                matches = [state for state in states if state["sessionId"] == plan.get("session_id") and state["batchId"] == plan.get("batch_id") and state["planHash"] == plan.get("plan_hash")]
                if len(matches) == 1:
                    state = matches[0]
                    if ("planPath" not in state or safe_path(state["planPath"], root) == plan_path) and ("taskRoot" not in state or safe_path(state["taskRoot"], root) == task_path):
                        return None
        except (OSError, ValueError, TypeError):
            pass
    hint = " Recovery: " + " | ".join(hints) if hints else " Recovery locator missing or invalid; supply the original frozen plan and task to native reconcile."
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Trellis owns an outstanding foreground batch. Continue or interrupt the original host wait handle. If unavailable, observe that same batch with native reconcile --wait; do not redispatch or take over FIFO. Dead coordinators require explicit reconciliation and verified provider exit." + hint}}


if __name__ == "__main__":
    result = decision(json.load(sys.stdin))
    if result:
        print(json.dumps(result))
