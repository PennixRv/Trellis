#!/usr/bin/env python3
"""Shared materialization for Python sub-agent context.

The shared Python Hook renders this projection for implement/check agents and
``task.py validate`` reads the same result before a task starts.  A notice is
still useful in a live prompt, but it is never a complete projection.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .paths import DIR_ARCHIVE, DIR_TASKS, DIR_WORKFLOW


DIRECTORY_MAX_FILES = 20


@dataclass(frozen=True)
class ContextEntry:
    """A normalised JSONL entry consumed by the Python Hook."""

    path: str
    entry_type: str
    reason: str
    line: int


@dataclass(frozen=True)
class ManifestProblem:
    """A malformed manifest row that the CLI must reject."""

    line: int
    message: str


@dataclass(frozen=True)
class ProjectionIssue:
    """Why one declared source was not represented as complete body text."""

    role: str
    category: str
    path: str
    reason: str
    line: int | None = None


@dataclass
class ContextProjection:
    """The Hook text and the facts the validator must fail closed on."""

    role: str
    text: str
    entries: list[ContextEntry] = field(default_factory=list)
    manifest_problems: list[ManifestProblem] = field(default_factory=list)
    issues: list[ProjectionIssue] = field(default_factory=list)
    manifest_exists: bool = False


class _Budget:
    def __init__(self, max_total_bytes: int) -> None:
        self.max_total_bytes = max_total_bytes
        self.used = 0

    def has_room(self, size: int) -> bool:
        return self.max_total_bytes <= 0 or self.used + size <= self.max_total_bytes

    def add(self, size: int) -> None:
        self.used += size


def truncate_utf8(data: bytes, cap: int) -> bytes:
    """Truncate at a valid UTF-8 boundary; zero means unlimited."""
    if cap <= 0 or len(data) <= cap:
        return data

    truncated = data[:cap]
    index = len(truncated)
    while index > 0 and (truncated[index - 1] & 0xC0) == 0x80:
        index -= 1
    if index == 0:
        return b""

    lead = truncated[index - 1]
    if lead & 0x80:
        if (lead & 0xE0) == 0xC0:
            sequence_length = 2
        elif (lead & 0xF0) == 0xE0:
            sequence_length = 3
        elif (lead & 0xF8) == 0xF0:
            sequence_length = 4
        else:
            sequence_length = 1
        if (index - 1) + sequence_length > len(truncated):
            return truncated[: index - 1]
    return truncated


def is_binary_content(data: bytes) -> bool:
    if b"\x00" in data:
        return True
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True
    return False


def parse_context_manifest(jsonl_file: Path) -> tuple[list[ContextEntry], list[ManifestProblem], bool]:
    """Parse the JSONL schema shared by the Hook and validation command."""
    if not jsonl_file.is_file():
        return [], [], False
    try:
        lines = jsonl_file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return [], [ManifestProblem(0, "Manifest is unreadable or is not valid UTF-8")], True

    entries: list[ContextEntry] = []
    problems: list[ManifestProblem] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            problems.append(ManifestProblem(line_number, "Invalid JSON"))
            continue
        if not isinstance(data, dict):
            problems.append(ManifestProblem(line_number, "Expected a JSON object"))
            continue
        if "_example" in data:
            problems.append(
                ManifestProblem(
                    line_number,
                    "Placeholder `_example` row left by an older task.py create — delete this line, or replace it with "
                    '{"file": "<path>", "reason": "<why>"}',
                )
            )
            continue

        file_value = data.get("file")
        path_value = data.get("path")
        if file_value not in (None, "") and not isinstance(file_value, str):
            problems.append(
                ManifestProblem(line_number, "`file` or legacy `path` must be a string path")
            )
            continue
        if path_value not in (None, "") and not isinstance(path_value, str):
            problems.append(
                ManifestProblem(line_number, "`file` or legacy `path` must be a string path")
            )
            continue
        value = file_value or path_value
        if not value:
            continue
        if not isinstance(value, str):
            problems.append(ManifestProblem(line_number, "`file` or legacy `path` must be a string path"))
            continue

        entry_type = data.get("type", "file")
        reason = data.get("reason") or "-"
        entries.append(
            ContextEntry(
                path=value,
                entry_type=entry_type if isinstance(entry_type, str) else "file",
                reason=reason if isinstance(reason, str) else str(reason),
                line=line_number,
            )
        )
    return entries, problems, True


def _real_path_contained(base_real: str, target_real: str) -> bool:
    try:
        return os.path.commonpath([base_real, target_real]) == base_real
    except ValueError:
        return False


def _is_allowed_path(repo_root: Path, candidate: Path) -> bool:
    try:
        root_real = os.path.realpath(repo_root)
        workflow_real = os.path.realpath(repo_root / DIR_WORKFLOW)
        candidate_real = os.path.realpath(candidate)
    except OSError:
        return False
    return _real_path_contained(root_real, candidate_real) or _real_path_contained(
        workflow_real, candidate_real
    )


def resolve_context_entry_path(file_path: str, repo_root: Path, task_dir: Path | None) -> Path | None:
    """Resolve an entry and preserve archived task self-reference semantics."""
    repo_path = repo_root / file_path
    if task_dir is None:
        return repo_path

    try:
        task_parts = task_dir.resolve().relative_to(repo_root.resolve()).parts
    except ValueError:
        return repo_path

    archive_prefix = (DIR_WORKFLOW, DIR_TASKS, DIR_ARCHIVE)
    if len(task_parts) != 5 or task_parts[:3] != archive_prefix:
        return repo_path

    year_month = task_parts[3]
    if (
        len(year_month) != 7
        or year_month[4] != "-"
        or not year_month[:4].isdigit()
        or not year_month[5:].isdigit()
    ):
        return repo_path

    historical_root = f"{DIR_WORKFLOW}/{DIR_TASKS}/{task_dir.name}"
    posix_path = file_path.replace("\\", "/")
    if posix_path == historical_root:
        relative_parts: tuple[str, ...] = ()
    elif posix_path.startswith(f"{historical_root}/"):
        relative_path = posix_path[len(historical_root) + 1 :].rstrip("/")
        relative_parts = tuple(relative_path.split("/")) if relative_path else ()
        if any(part in ("", ".", "..") for part in relative_parts):
            return None
    else:
        return repo_path

    try:
        archive_root = task_dir.resolve()
        resolved_path = task_dir.joinpath(*relative_parts).resolve()
        resolved_path.relative_to(archive_root)
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved_path


def _display_task_path(repo_root: Path, task_dir: Path, file_name: str) -> str:
    try:
        return (task_dir.relative_to(repo_root) / file_name).as_posix()
    except ValueError:
        return f"{task_dir.as_posix().rstrip('/')}/{file_name}"


def _truncate_notice(path: str, cap: int) -> str:
    return f"\n[Trellis: truncated at {cap} bytes — read {path} for the full content]"


def _binary_notice(path: str, size: int, reason: str) -> str:
    return f"[Trellis: not inlined (binary file) — {path} ({size} bytes): {reason}]"


def _index_notice(path: str, size: int, reason: str) -> str:
    return f"[Trellis: not inlined (total context limit reached) — {path} ({size} bytes): {reason}]"


def _append_block(
    projection: ContextProjection,
    budget: _Budget,
    *,
    header: str,
    path: str,
    content: str,
    size: int,
    reason: str,
    category: str,
    line: int | None,
) -> str:
    block = f"=== {header} ===\n{content}"
    block_bytes = len(block.encode("utf-8"))
    if budget.has_room(block_bytes):
        budget.add(block_bytes)
        return block

    notice = _index_notice(path, size, reason)
    budget.add(len(notice.encode("utf-8")))
    limit = budget.max_total_bytes
    projection.issues.append(
        ProjectionIssue(
            role=projection.role,
            category="total",
            path=path,
            reason=f"exceeds context_injection.max_total_bytes ({limit}); injection uses an index notice",
            line=line,
        )
    )
    return notice


def _new_projection(role: str, entries: list[ContextEntry], problems: list[ManifestProblem], manifest_exists: bool) -> ContextProjection:
    projection = ContextProjection(
        role=role,
        text="",
        entries=entries,
        manifest_problems=problems,
        manifest_exists=manifest_exists,
    )
    return projection


def _read_material(
    repo_root: Path, target: Path | None, category: str, path: str, projection: ContextProjection, line: int | None
) -> bytes | None:
    if target is None:
        projection.issues.append(
            ProjectionIssue(projection.role, category, path, "path cannot be resolved safely", line)
        )
        return None
    if not _is_allowed_path(repo_root, target):
        projection.issues.append(
            ProjectionIssue(projection.role, category, path, "path escapes the allowed project roots", line)
        )
        return None
    try:
        if not target.is_file():
            raise OSError
        return target.read_bytes()
    except OSError:
        projection.issues.append(
            ProjectionIssue(projection.role, category, path, "file is missing or unreadable", line)
        )
        return None


def _materialize_file(
    repo_root: Path,
    target: Path | None,
    path: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
    projection: ContextProjection,
    *,
    category: str,
    line: int | None,
    header: str | None = None,
    cap_key: str = "max_file_bytes",
) -> str | None:
    data = _read_material(repo_root, target, category, path, projection, line)
    if data is None:
        return None

    size = len(data)
    if is_binary_content(data):
        notice = _binary_notice(path, size, reason)
        budget.add(len(notice.encode("utf-8")))
        projection.issues.append(
            ProjectionIssue(projection.role, category, path, "binary content is not inlined", line)
        )
        return notice

    cap = limits[cap_key]
    materialized = truncate_utf8(data, cap)
    content = materialized.decode("utf-8")
    if len(materialized) < size:
        content += _truncate_notice(path, cap)
        projection.issues.append(
            ProjectionIssue(
                projection.role,
                category,
                path,
                f"exceeds context_injection.{cap_key} ({cap}); injection truncates it",
                line,
            )
        )
    return _append_block(
        projection,
        budget,
        header=header or path,
        path=path,
        content=content,
        size=size,
        reason=reason,
        category=category,
        line=line,
    )


def _materialize_directory(
    repo_root: Path,
    entry: ContextEntry,
    task_dir: Path,
    limits: dict[str, int],
    budget: _Budget,
    projection: ContextProjection,
) -> list[str]:
    target = resolve_context_entry_path(entry.path, repo_root, task_dir)
    if target is None or not _is_allowed_path(repo_root, target) or not target.is_dir():
        reason = "directory is missing, unreadable, or escapes the allowed project roots"
        projection.issues.append(
            ProjectionIssue(projection.role, "directory", entry.path, reason, entry.line)
        )
        return []
    try:
        files = sorted(
            child for child in target.iterdir() if child.suffix == ".md" and child.is_file()
        )
    except OSError:
        projection.issues.append(
            ProjectionIssue(projection.role, "directory", entry.path, "directory is unreadable", entry.line)
        )
        return []

    if not files:
        projection.issues.append(
            ProjectionIssue(
                projection.role, "directory", entry.path, "directory has no direct Markdown files to inject", entry.line
            )
        )
        return []
    if len(files) > DIRECTORY_MAX_FILES:
        projection.issues.append(
            ProjectionIssue(
                projection.role,
                "directory",
                entry.path,
                f"directory contains {len(files)} Markdown files; injection selects only the first {DIRECTORY_MAX_FILES}",
                entry.line,
            )
        )

    blocks: list[str] = []
    for child in files[:DIRECTORY_MAX_FILES]:
        display = f"{entry.path.rstrip('/')}/{child.name}"
        block = _materialize_file(
            repo_root,
            child,
            display,
            entry.reason,
            limits,
            budget,
            projection,
            category="file",
            line=entry.line,
        )
        if block:
            blocks.append(block)
    return blocks


def project_agent_context(
    repo_root: Path, task_dir: Path, agent_type: str, limits: dict[str, int]
) -> ContextProjection:
    """Render the exact Python Hook context and record every loss of body text."""
    jsonl_name = f"{agent_type}.jsonl"
    entries, manifest_problems, manifest_exists = parse_context_manifest(task_dir / jsonl_name)
    projection = _new_projection(agent_type, entries, manifest_problems, manifest_exists)
    budget = _Budget(limits["max_total_bytes"])
    blocks: list[str] = []

    for entry in entries:
        if entry.entry_type == "directory":
            blocks.extend(_materialize_directory(repo_root, entry, task_dir, limits, budget, projection))
            continue
        target = resolve_context_entry_path(entry.path, repo_root, task_dir)
        block = _materialize_file(
            repo_root,
            target,
            entry.path,
            entry.reason,
            limits,
            budget,
            projection,
            category="file",
            line=entry.line,
        )
        if block:
            blocks.append(block)

    if blocks:
        context_parts = ["\n\n".join(blocks)]
    else:
        context_parts = [
            f"[Trellis] {_display_task_path(repo_root, task_dir, jsonl_name)} has no curated entries, so no spec/research "
            "context was injected. Before working, read the guidelines relevant to the code you will touch under "
            ".trellis/spec/, and treat the task artifacts below as the only prepared context."
        ]

    artifact_specs = (
        ("prd.md", "Requirements", "Requirements document"),
        ("design.md", "Technical Design", "Technical design document"),
        ("implement.md", "Execution Plan", "Execution plan document"),
    )
    for file_name, label, reason in artifact_specs:
        target = task_dir / file_name
        if not target.exists():
            continue
        display = _display_task_path(repo_root, task_dir, file_name)
        block = _materialize_file(
            repo_root,
            target,
            display,
            reason,
            limits,
            budget,
            projection,
            category="artifact",
            line=None,
            header=f"{display} ({label})",
            cap_key="max_artifact_bytes",
        )
        if block:
            context_parts.append(block)

    projection.text = "\n\n".join(context_parts)
    return projection
