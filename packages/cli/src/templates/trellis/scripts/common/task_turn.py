"""Codex turn exit evidence; not a task lifecycle or permission authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import time
import uuid

from .active_task import _context_path, _write_json, resolve_context_key
from .io import JSON_READ_MISSING, read_json_checked, write_json
from .task_move import layout_lock, require_settled_layout
from .task_utils import resolve_task_dir
from .task_workflow import _artifact_digest, _state

KINDS = ("bounded_reply", "task_complete", "waiting_authorization",
         "waiting_input", "external_block", "user_stop")
SCOPES = ("explanation", "inspection", "handoff_admission")
TICKET_ID = re.compile(r"[0-9a-f]{32}\Z")
MAX_CORRECTIONS = 2
TICKET_SECONDS = 30


class TurnError(ValueError):
    pass


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def _text(value: object, name: str, limit: int = 512) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise TurnError(f"TASK_TURN_INVALID: missing or invalid {name}")
    return value


def _runtime_path(root: Path, path: Path) -> Path:
    runtime = root / ".trellis/.runtime"
    path.relative_to(runtime)
    if runtime.is_symlink():
        raise TurnError("TASK_TURN_WITHHELD: redirected runtime")
    current = runtime
    for part in path.relative_to(runtime).parts:
        current = current / part
        if current.is_symlink():
            raise TurnError("TASK_TURN_WITHHELD: redirected runtime")
    if path.exists() and not path.is_file():
        raise TurnError("TASK_TURN_WITHHELD: runtime record is not a regular file")
    return path


def _read(path: Path, *, missing: bool = False) -> dict:
    value, reason = read_json_checked(path)
    if value is None:
        if missing and reason == JSON_READ_MISSING:
            return {}
        raise TurnError("TASK_TURN_WITHHELD: runtime record is " + str(reason))
    return value


def _session(root: Path, key: str) -> tuple[Path, dict]:
    path = _runtime_path(root, _context_path(root, key))
    return path, _read(path, missing=True)


def _save(path: Path, context: dict) -> None:
    if not _write_json(path, context):
        raise TurnError("TASK_TURN_WRITE_FAILED: could not save session")


def _turn(context: dict, session: str | None = None, turn_id: str | None = None) -> dict:
    value = context.get("turn")
    if (not isinstance(value, dict)
            or set(value) != {"schema_version", "session_id", "turn_id", "prompt_digest", "corrections",
                              "evidence", "answers", "interrupted", "observed_task"}
            or type(value.get("schema_version")) is not int
            or value["schema_version"] != 1
            or type(value.get("corrections")) is not int
            or not 0 <= value["corrections"] <= MAX_CORRECTIONS
            or not isinstance(value.get("answers"), dict)
            or not isinstance(value.get("interrupted"), bool)
            or not isinstance(value.get("session_id"), str) or not value["session_id"]
            or not isinstance(value.get("turn_id"), str) or not value["turn_id"]
            or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("prompt_digest")))
            or session is not None and value.get("session_id") != session
            or turn_id is not None and value.get("turn_id") != turn_id):
        raise TurnError("TASK_TURN_WITHHELD: missing, stale or incompatible turn")
    for call_id, answer in value["answers"].items():
        if (not isinstance(call_id, str) or not call_id
                or not isinstance(answer, dict) or set(answer) != {"input_digest", "response_digest", "status"}
                or not re.fullmatch(r"[0-9a-f]{64}", str(answer["input_digest"]))
                or answer["response_digest"] is not None and not re.fullmatch(r"[0-9a-f]{64}", str(answer["response_digest"]))
                or not isinstance(answer["status"], str)
                or answer["status"] not in {"pending", "complete", "incomplete"}):
            raise TurnError("TASK_TURN_WITHHELD: incompatible answer observation")
    return value


def _identity(event: dict) -> tuple[str, str, str]:
    session = _text(event.get("session_id"), "native session_id")
    turn_id = _text(event.get("turn_id"), "native turn_id")
    key = resolve_context_key(event, platform="codex", allow_environment_context=False)
    if key is None:
        raise TurnError("TASK_TURN_WITHHELD: direct Codex identity is required")
    return key, session, turn_id


def _snapshot(root: Path, context: dict, turn: dict) -> dict | None:
    ref = context.get("current_task") or turn.get("observed_task")
    if ref is None:
        return None
    if not isinstance(ref, str):
        raise TurnError("TASK_TURN_WITHHELD: invalid task pointer")
    # Native basename resolution also handles a task moved by complete/cancel.
    directory = resolve_task_dir(ref if (root / ref).exists() else Path(ref).name, root)
    if directory is None:
        raise TurnError("TASK_TURN_WITHHELD: task is missing or ambiguous")
    task = _read(directory / "task.json")
    meta = task.get("meta", {})
    if not isinstance(meta, dict):
        raise TurnError("TASK_TURN_WITHHELD: invalid task metadata")
    state = _state(meta) if meta.get("task_workflow") is not None else None
    artifacts = {}
    if state:
        for phase, record in state["phases"].items():
            artifacts[phase] = _artifact_digest(directory, record["artifact_refs"])
    phase_id = state["current_phase_id"] if state else None
    return {"id": task.get("id") or task.get("name"),
            "path": directory.relative_to(root).as_posix(), "status": task.get("status"),
            "record_digest": _digest(task), "artifacts": artifacts,
            "phase_id": phase_id,
            "phase_status": state["phases"][phase_id]["status"] if state and phase_id else None,
            "route_revision": state["task_route_revision"] if state else None,
            "input_revision": state["input_revision"] if state else None,
            "closeout": state.get("closeout_disposition") if state else None}


def begin(root: Path, event: dict) -> dict:
    key, session, turn_id = _identity(event)
    prompt = _text(event.get("prompt"), "prompt", 1024 * 1024)
    with layout_lock(root):
        require_settled_layout(root)
        path, context = _session(root, key)
        previous = _turn(context) if "turn" in context else None
        if previous and previous["turn_id"] == turn_id and previous["prompt_digest"] == _digest(prompt):
            _turn(context, session, turn_id)
            return previous
        turn = {"schema_version": 1, "session_id": session, "turn_id": turn_id,
                "prompt_digest": _digest(prompt),
                "corrections": 0,
                "evidence": None, "answers": {}, "interrupted": False,
                }
        snapshot = _snapshot(root, context, {})
        turn["observed_task"] = snapshot["path"] if snapshot else None
        context["turn"] = turn
        _save(path, context)
        return turn


def _invocation(root: Path, command: str) -> tuple[list[str], str | None]:
    if os.name != "posix":
        raise TurnError("TASK_TURN_UNSUPPORTED: invocation rewriting requires a verified POSIX shell")
    if any(c in command for c in ("$", "`", "\n", "\r")):
        raise TurnError("TASK_TURN_WITHHELD: expansions and multiline shell commands are unsupported")
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|<>()")
    lexer.whitespace_split = True
    lexer.commenters = ""
    tokens = list(lexer)
    if any(token and all(c in ";&|<>()" for c in token) for token in tokens):
        raise TurnError("TASK_TURN_WITHHELD: use one direct Python task.py turn command")
    if len(tokens) < 4 or Path(tokens[0]).name not in {"python", "python3"}:
        raise TurnError("TASK_TURN_WITHHELD: use Python directly")
    index = 3 if tokens[1:3] == ["-X", "utf8"] else 1
    if (len(tokens) <= index + 2 or (root / tokens[index]).resolve() != (root / ".trellis/scripts/task.py").resolve()
            or tokens[index + 1] != "turn" or tokens[index + 2] not in {"show", "record"}):
        raise TurnError("TASK_TURN_WITHHELD: not a native turn invocation")
    argv = tokens[index + 2:]
    ticket = None
    if "--invocation-ticket" in argv:
        if len(argv) < 3 or argv[-2] != "--invocation-ticket" or argv.count("--invocation-ticket") != 1:
            raise TurnError("TASK_TURN_WITHHELD: invalid invocation ticket argument")
        ticket = argv[-1]
        argv = argv[:-2]
    return argv, ticket


def _ticket_path(root: Path, ticket_id: str) -> Path:
    if not TICKET_ID.fullmatch(ticket_id):
        raise TurnError("TASK_TURN_WITHHELD: invalid invocation ticket")
    return _runtime_path(root, root / ".trellis/.runtime/shell-tickets" / f"turn-{ticket_id}.json")


def _expire_tickets(root: Path) -> None:
    directory = root / ".trellis/.runtime/shell-tickets"
    for path in directory.glob("turn-*.json"):
        if not TICKET_ID.fullmatch(path.stem[5:]):
            continue
        try:
            ticket = _read(_runtime_path(root, path))
        except TurnError:
            continue
        if (set(ticket) == {"schema_version", "context_key", "session_id", "turn_id", "tool_use_id",
                            "cwd", "argv_digest", "snapshot_digest", "expires_at_epoch", "used"}
                and type(ticket.get("schema_version")) is int and ticket["schema_version"] == 1
                and ticket.get("cwd") == str(root.resolve())
                and type(ticket.get("used")) is bool
                and type(ticket.get("expires_at_epoch")) in (int, float)
                and ticket["expires_at_epoch"] < time.time()):
            path.unlink()


def ticket_input(root: Path, event: dict) -> dict:
    key, session, turn_id = _identity(event)
    tool_input = event.get("tool_input")
    if not isinstance(tool_input, dict):
        raise TurnError("TASK_TURN_WITHHELD: invalid Bash input")
    command = _text(tool_input.get("command"), "Bash command", 16384)
    argv, existing = _invocation(root, command)
    call_id = _text(event.get("tool_use_id"), "tool_use_id")
    cwd = Path(_text(event.get("cwd"), "cwd", 4096)).resolve()
    if cwd != root.resolve():
        raise TurnError("TASK_TURN_WITHHELD: run turn commands from the project root")
    with layout_lock(root):
        require_settled_layout(root)
        _, context = _session(root, key)
        turn = _turn(context, session, turn_id)
        if turn["interrupted"]:
            raise TurnError("TASK_TURN_WITHHELD: user interrupted this turn")
        snapshot = _digest(_snapshot(root, context, turn))
        if existing:
            ticket = _read(_ticket_path(root, existing))
            _check_ticket(ticket, root, argv, turn)
            if ticket.get("tool_use_id") != call_id:
                raise TurnError("TASK_TURN_WITHHELD: rewritten call identity changed")
            return tool_input
        _expire_tickets(root)
        ticket_id = uuid.uuid4().hex
        ticket = {"schema_version": 1, "context_key": key, "session_id": session,
                  "turn_id": turn_id, "tool_use_id": call_id, "cwd": str(root.resolve()),
                  "argv_digest": _digest(argv), "snapshot_digest": snapshot,
                  "expires_at_epoch": time.time() + TICKET_SECONDS, "used": False}
        ticket_path = _ticket_path(root, ticket_id)
        ticket_path.parent.mkdir(parents=True, exist_ok=True)
        if ticket_path.exists():
            raise TurnError("TASK_TURN_WITHHELD: invocation ticket collision")
        if not write_json(ticket_path, ticket):
            raise TurnError("TASK_TURN_WRITE_FAILED: could not issue invocation ticket")
    return {**tool_input, "command": command + " --invocation-ticket " + ticket_id}


def _check_ticket(ticket: dict, root: Path, argv: list[str], turn: dict) -> None:
    if (ticket.get("schema_version") != 1 or ticket.get("used") is not False
            or ticket.get("cwd") != str(root.resolve())
            or ticket.get("session_id") != turn["session_id"] or ticket.get("turn_id") != turn["turn_id"]
            or ticket.get("argv_digest") != _digest(argv)
            or type(ticket.get("expires_at_epoch")) not in (int, float)
            or not 0 <= ticket["expires_at_epoch"] - time.time() <= TICKET_SECONDS):
        raise TurnError("TASK_TURN_WITHHELD: expired, replayed or mismatched invocation")


def _evidence(args: argparse.Namespace, turn: dict, snapshot: dict | None) -> dict:
    refs = args.evidence_ref or []
    if not refs or any(not re.fullmatch(r"[A-Za-z0-9_.:/@-]{1,512}", ref) for ref in refs):
        raise TurnError("TASK_TURN_INVALID: nonempty evidence references are required")
    kind = args.kind
    if kind not in KINDS:
        raise TurnError("TASK_TURN_INVALID: unsupported exit kind")
    result = {"kind": kind, "evidence_refs": refs, "snapshot_digest": _digest(snapshot)}
    if kind == "bounded_reply":
        result["scope"] = args.scope
    elif kind in {"waiting_authorization", "waiting_input", "external_block"}:
        result["no_independent_work"] = args.no_independent_work
        if kind != "external_block":
            question = _text(args.question, "explicit final question")
            result.update(question_digest=_digest(question), question_length=len(question))
    elif kind == "user_stop":
        result["user_prompt_digest"] = _digest(_text(args.user_instruction, "user instruction", 1024 * 1024))
    if not _valid_exit(result, snapshot, turn):
        raise TurnError("TASK_TURN_WITHHELD: exit evidence does not match native task, scope or user input")
    return result


def _valid_exit(evidence: object, snapshot: dict | None, turn: dict) -> bool:
    if not isinstance(evidence, dict) or evidence.get("kind") not in KINDS or evidence.get("snapshot_digest") != _digest(snapshot):
        return False
    refs = evidence.get("evidence_refs")
    if not isinstance(refs, list) or not refs or not all(isinstance(ref, str) and re.fullmatch(r"[A-Za-z0-9_.:/@-]{1,512}", ref) for ref in refs):
        return False
    kind = evidence["kind"]
    if kind == "bounded_reply":
        return evidence.get("scope") in SCOPES
    if kind == "task_complete":
        return snapshot is not None and (snapshot["status"] in {"completed", "cancelled"}
                                        or snapshot["phase_id"] is None and snapshot["closeout"] in {"delivery_ready", "no_go"})
    if kind == "user_stop":
        return evidence.get("user_prompt_digest") == turn["prompt_digest"]
    expected = "blocked" if kind == "external_block" else "waiting_user"
    return evidence.get("no_independent_work") is True and (
        snapshot is not None and snapshot["phase_status"] == expected
        or snapshot is None and kind != "external_block"
    )


def cli(root: Path, args: argparse.Namespace, argv: list[str]) -> dict:
    with layout_lock(root):
        require_settled_layout(root)
        ticket_id = args.invocation_ticket
        if ticket_id is None:
            if args.turn_action == "record":
                raise TurnError("TASK_TURN_WITHHELD: record requires the exact PreToolUse invocation ticket")
            key = resolve_context_key()
            if key is None:
                return {"status": "unavailable", "reason": "no direct session identity"}
            _, context = _session(root, key)
            return {"status": "observed" if "turn" in context else "absent",
                    "turn": _turn(context) if "turn" in context else None}
        ticket_path = _ticket_path(root, ticket_id)
        ticket = _read(ticket_path)
        key = _text(ticket.get("context_key"), "ticket context_key")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", key):
            raise TurnError("TASK_TURN_WITHHELD: invalid ticket context key")
        path, context = _session(root, key)
        turn = _turn(context)
        _check_ticket(ticket, root, argv, turn)
        direct = resolve_context_key(allow_environment_context=True)
        if direct is not None and direct != key:
            raise TurnError("TASK_TURN_WITHHELD: native session and ticket disagree")
        if turn["interrupted"]:
            raise TurnError("TASK_TURN_WITHHELD: interrupted turn")
        snapshot = _snapshot(root, context, turn)
        if ticket.get("snapshot_digest") != _digest(snapshot):
            raise TurnError("TASK_TURN_WITHHELD: task or artifact revision changed")
        evidence = _evidence(args, turn, snapshot) if args.turn_action == "record" else None
        # Burn first: a crash can withhold evidence, never reuse a successful call.
        ticket["used"] = True
        if not write_json(ticket_path, ticket):
            raise TurnError("TASK_TURN_WRITE_FAILED: could not consume invocation ticket")
        if evidence is not None:
            turn["evidence"] = evidence
            if snapshot:
                turn["observed_task"] = snapshot["path"]
            _save(path, context)
        return {"status": "recorded" if evidence is not None else "observed", "turn": turn}


def observe(root: Path, event: dict) -> dict:
    key, session, turn_id = _identity(event)
    with layout_lock(root):
        path, context = _session(root, key)
        turn = _turn(context, session, turn_id)
        snapshot = _snapshot(root, context, turn)
        if snapshot:
            turn["observed_task"] = snapshot["path"]
        if event.get("tool_name") != "request_user_input":
            _save(path, context)
            return {}
        call_id = _text(event.get("tool_use_id"), "tool_use_id")
        input_digest = _digest(event.get("tool_input"))
        response_digest = _digest(event.get("tool_response"))
        prior = turn["answers"].get(call_id)
        if not isinstance(prior, dict) or prior.get("input_digest") != input_digest:
            turn["evidence"] = None
            _save(path, context)
            raise TurnError("TASK_TURN_WITHHELD: answer has no matching native question invocation")
        if prior.get("status") != "pending":
            if prior.get("response_digest") != response_digest:
                turn["evidence"] = None
                _save(path, context)
                raise TurnError("TASK_TURN_WITHHELD: conflicting duplicate answer")
            return {}
        response = event.get("tool_response")
        if isinstance(response, str):
            try:
                response = json.loads(response)
            except ValueError:
                response = None
        tool_input = event.get("tool_input")
        questions = tool_input.get("questions") if isinstance(tool_input, dict) else None
        questions = questions if isinstance(questions, list) else []
        answers = response.get("answers") if isinstance(response, dict) else None
        ids = [q.get("id") if isinstance(q, dict) else None for q in questions]
        complete = (0 < len(ids) <= 3 and all(isinstance(i, str) and i for i in ids)
                    and len(set(ids)) == len(ids) and isinstance(answers, dict) and set(ids) == set(answers)
                    and all(isinstance(q, dict) and isinstance(q.get("question"), str) and q["question"].strip()
                            for q in questions)
                    and all(isinstance(answers[i], dict) and isinstance(answers[i].get("answers"), list)
                            and answers[i]["answers"] and all(isinstance(v, str) and v.strip() for v in answers[i]["answers"]) for i in ids))
        turn["answers"][call_id] = {"input_digest": input_digest, "response_digest": response_digest,
                                   "status": "complete" if complete else "incomplete"}
        turn["evidence"] = None
        _save(path, context)
        return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext":
                "A real answer returned. Record it, resume a resolved phase wait, and continue authorized work."
                if complete else "No complete answer is established. Do not invent a choice; follow the host cancellation/empty-answer contract and continue independent authorized work."}}


def question_started(root: Path, event: dict) -> None:
    key, session, turn_id = _identity(event)
    call_id = _text(event.get("tool_use_id"), "tool_use_id")
    input_digest = _digest(event.get("tool_input"))
    with layout_lock(root):
        path, context = _session(root, key)
        turn = _turn(context, session, turn_id)
        prior = turn["answers"].get(call_id)
        if prior is not None:
            if not isinstance(prior, dict) or prior.get("input_digest") != input_digest:
                turn["evidence"] = None
                _save(path, context)
                raise TurnError("TASK_TURN_WITHHELD: question invocation identity changed")
            return
        turn["answers"][call_id] = {"input_digest": input_digest, "response_digest": None, "status": "pending"}
        turn["evidence"] = None
        _save(path, context)


def stop(root: Path, event: dict) -> dict:
    key, session, turn_id = _identity(event)
    with layout_lock(root):
        path, context = _session(root, key)
        turn = _turn(context, session, turn_id)
        if turn["interrupted"]:
            return {"continue": False, "systemMessage": "Trellis: user interruption preserved; no automatic continuation."}
        evidence = turn.get("evidence")
        valid = _valid_exit(evidence, _snapshot(root, context, turn), turn)
        if valid and isinstance(evidence, dict) and evidence.get("kind") in {"waiting_authorization", "waiting_input"}:
            message = event.get("last_assistant_message")
            length = evidence.get("question_length")
            valid = (isinstance(message, str) and len(message) <= 65536 and type(length) is int
                     and 0 < length <= 512 and any(_digest(message[i:i + length]) == evidence["question_digest"]
                                                  for i in range(len(message) - length + 1)))
        if valid:
            return {}
        if turn["corrections"] >= MAX_CORRECTIONS:
            return {"continue": False, "systemMessage": "TASK_TURN_PROTECTION_FAILED: correction limit reached; task remains unfinished. Inspect turn evidence before continuing manually."}
        reason = ("Trellis turn guard: continue independent authorized work or ask the actual blocking question; "
                  "record native task.py turn evidence before ending. This feedback is not a user answer or approval. "
                  "Correction " + str(turn["corrections"] + 1) + " of " + str(MAX_CORRECTIONS) + ".")
        turn["corrections"] += 1
        _save(path, context)
        return {"decision": "block", "reason": reason}


def interrupt(root: Path, event: dict) -> None:
    key, session, turn_id = _identity(event)
    with layout_lock(root):
        path, context = _session(root, key)
        turn = _turn(context, session, turn_id)
        turn.update(interrupted=True, evidence=None)
        _save(path, context)


def add_turn_commands(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser("turn", help="Observe or record native current-turn exit evidence")
    actions = parser.add_subparsers(dest="turn_action", required=True)
    show = actions.add_parser("show", help="Read current native turn; missing identity never grants exit evidence")
    show.add_argument("--invocation-ticket")
    record = actions.add_parser("record", help="Record exit evidence using the exact hook-issued invocation")
    record.add_argument("--invocation-ticket")
    record.add_argument("--kind", choices=KINDS, required=True)
    record.add_argument("--scope", choices=SCOPES)
    record.add_argument("--evidence-ref", action="append", required=True)
    record.add_argument("--no-independent-work", action="store_true")
    record.add_argument("--question")
    record.add_argument("--user-instruction")
