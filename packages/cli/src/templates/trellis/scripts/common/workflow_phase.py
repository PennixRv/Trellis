#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Workflow Phase Extraction.

Extracts step-level content from .trellis/workflow.md and optionally filters
platform-specific blocks.

Platform marker syntax in workflow.md:

    [Claude Code, Cursor, ...]
    agent-capable content
    [/Claude Code, Cursor, ...]

Provides:
    get_phase_index   - Extract the phase index section (no --step)
    get_step          - Extract a single step (#### X.X) section
    filter_platform   - Strip platform blocks that don't include the given name
"""

from __future__ import annotations

import re

from . import workflow_selection
from .paths import get_repo_root


def _workflow_md_path():
    return workflow_selection.resolve_workflow_md(get_repo_root())

# Match a line that *is* a platform marker: "[A, B, C]" or "[/A, B, C]"
_MARKER_RE = re.compile(r"^\[(/?)([A-Za-z][^\[\]]*)\]\s*$")

# Step heading: "#### 1.0 Title" or "#### 1.0 ..."
_STEP_HEADING_RE = re.compile(r"^####\s+(\d+\.\d+)\b.*$")

# Phase Index ends at the first section heading that follows it.
_PHASE_INDEX_HEADINGS = {"## 阶段索引", "## Phase Index"}
_NEXT_PHASE_SECTION_RE = re.compile(r"^#{2,3}\s+")


def _read_workflow() -> str:
    path = _workflow_md_path()
    if not path.exists():
        raise FileNotFoundError(f"workflow.md not found: {path}")
    return path.read_text(encoding="utf-8")


def _parse_marker(line: str) -> tuple[bool, list[str]] | None:
    """Parse a platform marker line.

    Returns:
        (is_closing, [platform_names]) if line is a marker, else None.
    """
    m = _MARKER_RE.match(line)
    if not m:
        return None
    is_closing = m.group(1) == "/"
    names = [p.strip() for p in m.group(2).split(",") if p.strip()]
    return is_closing, names


def get_phase_index() -> str:
    """Return the compact Phase Index summary from workflow.md.

    SessionStart and no-step phase context use this small summary as their
    orientation payload. Detailed phase instructions are loaded with
    ``get_step`` on demand. ``[workflow-state:STATUS]`` tag blocks are
    consumed by the per-turn hook, so they're stripped from this output.
    """
    text = _read_workflow()
    lines = text.splitlines()

    start: int | None = None
    end: int | None = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if start is None and stripped in _PHASE_INDEX_HEADINGS:
            start = i
            continue
        if start is not None and _NEXT_PHASE_SECTION_RE.match(stripped):
            end = i
            break

    if start is None:
        return ""
    if end is None:
        end = len(lines)

    section = "\n".join(lines[start:end]).rstrip()
    # Strip [workflow-state:STATUS]...[/workflow-state:STATUS] blocks since
    # they're injected separately by inject-workflow-state.py per-turn.
    import re as _re
    tag_re = _re.compile(
        r"\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n.*?\n\s*\[/workflow-state:\1\]\n?",
        _re.DOTALL,
    )
    return tag_re.sub("", section).rstrip() + "\n"


def get_step(step_id: str) -> str:
    """Return the `#### X.X` section matching step_id (header + body).

    Body ends at the next `####` or `---` or `##` heading (whichever comes first).
    """
    text = _read_workflow()
    lines = text.splitlines()

    start: int | None = None
    for i, line in enumerate(lines):
        m = _STEP_HEADING_RE.match(line)
        if m and m.group(1) == step_id:
            start = i
            break
    if start is None:
        return ""

    end: int = len(lines)
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if line.startswith("#### "):
            end = j
            break
        if line.startswith("## "):
            end = j
            break
        # Horizontal rule at column 0
        if line.strip() == "---":
            end = j
            break

    return "\n".join(lines[start:end]).rstrip() + "\n"


def _platform_matches(platform: str, block_names: list[str]) -> bool:
    """Case-insensitive fuzzy match: accept 'cursor', 'Cursor', 'claude-code', 'Claude Code'."""
    needle = platform.lower().replace("-", "").replace("_", "").replace(" ", "")
    for name in block_names:
        hay = name.lower().replace("-", "").replace("_", "").replace(" ", "")
        if needle == hay:
            return True
    return False


_PLATFORM_MARKER_LABELS: dict[str, str] = {
    # workflow.md marker blocks label platforms with their product names, but
    # every caller passes the stable id instead (`--platform {{CLI_FLAG}}` in
    # the start / continue commands). `_platform_matches` only strips
    # punctuation, so an id that is not its label-minus-spaces never matches and
    # `filter_platform` drops the block WITHOUT error — the section just comes
    # back empty. Four platforms shipped that way before this table existed.
    #
    # Add an entry whenever a platform's id is not its marker label with the
    # separators removed. `test/registry-invariants.test.ts` asserts every
    # registry id keeps a non-empty routing section, so a missing entry fails
    # there rather than silently blanking that platform's routing.
    "claude": "Claude Code",
    "kimi": "Kimi Code",
    "omp": "Oh My Pi",
    "dsh": "DeepSeek Harness",
}


def resolve_platform_label(platform: str) -> str:
    """Resolve a real host identifier to its workflow marker label."""
    return _PLATFORM_MARKER_LABELS.get(platform.strip().lower(), platform)


def filter_platform(content: str, platform: str) -> str:
    """Keep lines outside any `[...]` block + lines inside blocks that include platform.

    Marker lines themselves are dropped from the output.
    """
    lines = content.splitlines()
    out: list[str] = []

    in_block = False
    keep_block = False

    for line in lines:
        marker = _parse_marker(line)
        if marker is not None:
            is_closing, names = marker
            if not is_closing:
                in_block = True
                keep_block = _platform_matches(platform, names)
            else:
                in_block = False
                keep_block = False
            continue  # drop the marker line itself

        if in_block:
            if keep_block:
                out.append(line)
            continue
        out.append(line)

    # Collapse runs of 3+ blank lines that may arise from dropped markers
    collapsed: list[str] = []
    blank_run = 0
    for line in out:
        if line.strip() == "":
            blank_run += 1
            if blank_run <= 2:
                collapsed.append(line)
        else:
            blank_run = 0
            collapsed.append(line)

    return "\n".join(collapsed).rstrip() + "\n"
