#!/usr/bin/env python3
"""Codex PreToolUse guard for CLI-owned foreground batches.

Only supported host tool hooks are guarded. Ordinary model messages and tools
that the host does not expose to PreToolUse remain Skill obligations.
"""
from __future__ import annotations

import hashlib
import json
import os
import shlex
import sys
from pathlib import Path


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
    if not directory.exists():
        return None
    records = list(directory.glob("*.json"))
    if not records:
        return None
    for record in records:
        try:
            state = json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue
    tool = str(payload.get("tool_name", "")).rsplit(".", 1)[-1]
    if tool in {"write_stdin", "wait"}:
        return None
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    command = tool_input.get("command", tool_input.get("cmd"))
    if isinstance(command, str) and not any(character in command for character in "$`;\n&|<>"):
        try:
            argv = shlex.split(command)
        except ValueError:
            argv = []
        if argv[:3] == ["trellis", "teamwork", "reconcile"]:
            return None
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Trellis owns an outstanding foreground batch. Silently continue the original host wait handle, or interrupt that same handle. A dead coordinator still requires native teamwork reconcile; do not start another batch or take over FIFO scheduling."}}


if __name__ == "__main__":
    result = decision(json.load(sys.stdin))
    if result:
        print(json.dumps(result))
