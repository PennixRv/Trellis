#!/usr/bin/env python3
"""Append one bounded coordinator note to the current developer workspace."""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn

from common.paths import DIR_WORKFLOW, DIR_WORKSPACE, get_developer, get_repo_root, get_workspace_dir


ALLOWED_KINDS = {"observation", "decision", "open-question", "blocker"}
MAX_SUMMARY_LENGTH = 600
MAX_SOURCES = 5
MAX_SOURCE_LENGTH = 1024
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
)


class WorkspaceNoteError(Exception):
    """A user-correctable workspace-note failure."""


def _fail(message: str) -> NoReturn:
    raise WorkspaceNoteError(message)


def _validate_text(value: str, field: str, max_length: int) -> str:
    if not value.strip() or len(value) > max_length:
        _fail(f"{field} must be a non-empty string of at most {max_length} characters")
    if "\n" in value or "\r" in value or "\x00" in value:
        _fail(f"{field} must be a single line without control characters")
    for pattern in SECRET_PATTERNS:
        if pattern.search(value):
            _fail(f"{field} appears to contain a credential")
    return value


def _workspace_path(repo_root: Path) -> Path:
    developer = get_developer(repo_root)
    workspace_dir = get_workspace_dir(repo_root)
    if not developer or workspace_dir is None:
        _fail("developer is not initialized; run init_developer.py first")
    workspace_root = repo_root / DIR_WORKFLOW / DIR_WORKSPACE
    if workspace_dir.is_symlink():
        _fail(f"refusing symlinked developer workspace: {workspace_dir}")
    try:
        workspace_root_resolved = workspace_root.resolve(strict=True)
        workspace_resolved = workspace_dir.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        _fail(f"could not resolve developer workspace: {exc}")
    if workspace_resolved.parent != workspace_root_resolved:
        _fail("developer workspace is not a direct workspace child")
    if workspace_dir.name != developer:
        _fail("developer identity does not name its workspace directory")
    return workspace_dir / "working-notes.md"


def _append_record(path: Path, record: str) -> None:
    if path.is_symlink():
        _fail(f"refusing symlinked working notes file: {path}")
    flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    try:
        descriptor = os.open(path, flags, 0o600)
        try:
            data = record.encode("utf-8")
            written = os.write(descriptor, data)
            if written != len(data):
                _fail("could not append the complete workspace note")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as exc:
        _fail(f"could not append workspace note {path}: {exc}")


def _main(args: argparse.Namespace) -> None:
    if args.kind not in ALLOWED_KINDS:
        _fail(f"--kind must be one of: {', '.join(sorted(ALLOWED_KINDS))}")
    summary = _validate_text(args.summary, "--summary", MAX_SUMMARY_LENGTH)
    if len(args.source) > MAX_SOURCES:
        _fail(f"at most {MAX_SOURCES} --source values are allowed")
    sources = [
        _validate_text(value, "--source", MAX_SOURCE_LENGTH)
        for value in args.source
    ]
    repo_root = get_repo_root()
    path = _workspace_path(repo_root)
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    lines = [f"## {timestamp} | {args.kind}", "", summary]
    if sources:
        lines.extend(["", "Sources:"])
        lines.extend(f"- {source}" for source in sources)
    _append_record(path, "\n".join(lines) + "\n\n")
    print(path.relative_to(repo_root).as_posix())


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", required=True, choices=sorted(ALLOWED_KINDS))
    parser.add_argument("--summary", required=True)
    parser.add_argument("--source", action="append", default=[])
    return parser


def main() -> int:
    try:
        _main(_parser().parse_args())
    except WorkspaceNoteError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
