#!/usr/bin/env python3
"""Codex native turn observation and bounded Stop continuation."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


def main() -> int:
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return 0
    event = {}
    result: dict = {}
    try:
        event = json.load(sys.stdin)
        if not isinstance(event, dict):
            raise ValueError("invalid hook envelope")
        if event.get("agent_id") is not None:
            return 0
        root = Path(str(event.get("cwd", os.getcwd()))).resolve()
        while not (root / ".trellis").is_dir():
            if root == root.parent:
                return 0
            root = root.parent
        sys.path.insert(0, str(root / ".trellis/scripts"))
        from common.task_turn import begin, interrupt, observe, question_started, stop  # type: ignore[import-not-found]

        name = event.get("hook_event_name")
        if name == "UserPromptSubmit":
            begin(root, event)
            result = {"hookSpecificOutput": {"hookEventName": name, "additionalContext":
                      "Before ending this request, record native exit evidence via a single direct "
                      "Python .trellis/scripts/task.py turn record command from the project root. "
                      "Use --kind and --evidence-ref; bounded_reply also needs --scope; waits need "
                      "--no-independent-work and --question. Use turn record --help for current arguments. "
                      "A tool answer or passing local test is not completion. Continue independent "
                      "authorized work. This guard grants no permission or task-phase acceptance."}}
        elif name == "PostToolUse":
            result = observe(root, event)
        elif name == "PreToolUse" and event.get("tool_name") == "request_user_input":
            question_started(root, event)
            result = {}
        elif name == "Interrupt":
            interrupt(root, event)
            result = {}
        elif name == "Stop":
            result = stop(root, event)
        else:
            return 0
    except Exception as error:
        # Native Stop failure is visible and finite, never a successful exit proof.
        detail = str(error) if isinstance(error, ValueError) and str(error).startswith("TASK_TURN_") else type(error).__name__
        result = {"systemMessage": "TASK_TURN_PROTECTION_FAILED: " + detail
                  + "; inspect native turn state. No completion or approval is established."}
        if isinstance(event, dict) and event.get("hook_event_name") == "Stop":
            result["continue"] = False
    if result:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
