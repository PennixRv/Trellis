#!/usr/bin/env python3
"""
Task JSONL context management.

Provides:
    cmd_add_context   - Add entry to JSONL context file
    cmd_validate      - Validate JSONL context files
    cmd_list_context  - List JSONL context entries

Note:
    ``cmd_init_context`` was removed in v0.5.0-beta.12. JSONL context files
    are created empty at ``task.py create`` time; the AI agent curates real
    entries during planning when the task needs sub-agent/spec context. See
    ``.trellis/workflow.md`` for the current planning artifact contract.

    Older Trellis versions seeded those files with a ``{"_example": ...}``
    placeholder row. ``cmd_validate`` now rejects that row so a task cannot
    validate locally and then fail PR preflight, which treats it as
    unresolved scaffolding.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import get_context_injection_limits
from .context_projection import parse_context_manifest, project_agent_context
from .git import branch_exists_locally
from .io import read_json
from .log import Colors, colored
from .paths import FILE_TASK_JSON, get_repo_root
from .task_utils import resolve_task_dir

# Extensions that look like code rather than spec/research docs. Entries with
# one of these extensions outside .trellis/spec/, docs/docs-site, or the
# task's own directory get a hygiene warning in `task.py validate` — the
# reader is a sub-agent, not a human, so code paths belong in the diff the
# agent reads itself, not in implement.jsonl / check.jsonl.
_CODE_FILE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".rb",
    ".c",
    ".cc",
    ".cpp",
    ".h",
}


# =============================================================================
# Command: add-context
# =============================================================================

def cmd_add_context(args: argparse.Namespace) -> int:
    """Add entry to JSONL context file."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)
    if target_dir is None:
        return 1

    jsonl_name = args.file
    path = args.path
    reason = args.reason or "Added manually"

    if not target_dir or not target_dir.is_dir():
        print(colored(f"Error: Directory not found: {target_dir}", Colors.RED))
        return 1

    # The JSONL name is user input joined onto the task dir — keep it a plain
    # filename so it cannot create files elsewhere.
    if "/" in jsonl_name or "\\" in jsonl_name or jsonl_name in (".", ".."):
        print(colored(
            f"Error: context file must be a plain name (e.g. implement, check): {jsonl_name}",
            Colors.RED,
        ))
        return 1

    # Support shorthand
    if not jsonl_name.endswith(".jsonl"):
        jsonl_name = f"{jsonl_name}.jsonl"

    jsonl_file = target_dir / jsonl_name
    full_path = repo_root / path

    entry_type = "file"
    if full_path.is_dir():
        entry_type = "directory"
        if not path.endswith("/"):
            path = f"{path}/"
    elif not full_path.is_file():
        print(colored(f"Error: Path not found: {path}", Colors.RED))
        return 1

    # Check if already exists
    if jsonl_file.is_file():
        content = jsonl_file.read_text(encoding="utf-8")
        if f'"{path}"' in content:
            print(colored(f"Warning: Entry already exists for {path}", Colors.YELLOW))
            return 0

    # Add entry
    entry: dict
    if entry_type == "directory":
        entry = {"file": path, "type": "directory", "reason": reason}
    else:
        entry = {"file": path, "reason": reason}

    with jsonl_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(colored(f"Added {entry_type}: {path}", Colors.GREEN))
    return 0


# =============================================================================
# Command: validate
# =============================================================================

def curated_entry_count(jsonl_file: Path) -> int | None:
    """Count curated entries in a jsonl context manifest.

    Returns None when the file does not exist — `task.py create` seeds the
    manifests only on sub-agent-capable platforms, so an absent file means no
    sub-agent will ever read it and callers should not gate on it. A curated
    entry is a JSON object row carrying a truthy ``file`` (or legacy ``path``)
    value: the same rows the sub-agent injection hook materializes.
    """
    entries, _, manifest_exists = parse_context_manifest(jsonl_file)
    return len(entries) if manifest_exists else None


def cmd_validate(args: argparse.Namespace) -> int:
    """Validate JSONL context files."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    if target_dir is None or not target_dir.is_dir():
        print(colored("Error: task directory required", Colors.RED))
        return 1

    print(colored("=== Validating Context Files ===", Colors.BLUE))
    print(f"Target dir: {target_dir}")
    print()

    # Warn (don't fail validation) when the recorded branch is stale — it
    # was likely already merged and deleted (#399 item 2).
    task_json_path = target_dir / FILE_TASK_JSON
    if task_json_path.is_file():
        task_data = read_json(task_json_path)
        stored_branch = task_data.get("branch") if task_data else None
        if stored_branch and not branch_exists_locally(stored_branch, repo_root):
            print(
                colored(
                    f"Warning: recorded branch '{stored_branch}' no longer exists locally "
                    "(likely merged and deleted).",
                    Colors.YELLOW,
                )
            )
            print()

    total_errors = 0
    for jsonl_name in ["implement.jsonl", "check.jsonl"]:
        jsonl_file = target_dir / jsonl_name
        errors = _validate_jsonl(jsonl_file, repo_root, target_dir)
        total_errors += errors

    print()
    if total_errors == 0:
        print(colored("✓ All validations passed", Colors.GREEN))
        return 0
    else:
        print(colored(f"✗ Validation failed ({total_errors} errors)", Colors.RED))
        return 1


def _is_exempt_from_code_file_warning(file_path: str, task_rel: str) -> bool:
    """Whether a jsonl entry path is exempt from the code-file hygiene warning.

    Exempt: spec docs (``.trellis/spec/``), documentation (``docs``,
    ``docs-site``), and the task's own directory (execution plans, generated
    artifacts, etc. legitimately live there).
    """
    posix_path = file_path.replace("\\", "/").lstrip("/")
    exempt_prefixes = (".trellis/spec/", "docs/", "docs-site/")
    if posix_path.startswith(exempt_prefixes):
        return True
    if task_rel and (posix_path == task_rel or posix_path.startswith(f"{task_rel}/")):
        return True
    return False


def _validate_jsonl(jsonl_file: Path, repo_root: Path, task_dir: Path | None = None) -> int:
    """Validate a single JSONL file.

    ``{"_example": ...}`` placeholder rows written by older Trellis versions
    are hard errors: PR preflight rejects them as unresolved scaffolding, so
    accepting them here would pass locally and fail later. Other rows without
    a ``file`` field are skipped silently, matching what consumers do.

    The same Python projection that the shared Hook renders is evaluated for
    each role. Hygiene warnings remain advisory; every source that would be
    truncated, omitted, or indexed instead of appearing as complete body text
    is a hard validation error.
    """
    file_name = jsonl_file.name
    errors = 0

    if not jsonl_file.is_file():
        print(f"  {colored(f'{file_name}: not found (skipped)', Colors.YELLOW)}")
        return 0

    task_rel = ""
    if task_dir is not None:
        try:
            task_rel = task_dir.resolve().relative_to(repo_root.resolve()).as_posix()
        except ValueError:
            task_rel = ""

    entries, manifest_problems, _ = parse_context_manifest(jsonl_file)
    for problem in manifest_problems:
        print(f"  {colored(f'{file_name}:{problem.line}: {problem.message}', Colors.RED)}")
        errors += 1

    for entry in entries:
        if entry.entry_type == "directory":
            continue
        extension = Path(entry.path).suffix.lower()
        if extension in _CODE_FILE_EXTENSIONS and not _is_exempt_from_code_file_warning(
            entry.path, task_rel
        ):
            warning_message = (
                f"{file_name}:{entry.line}: Warning: {entry.path} looks like a code file — "
                "implement/check.jsonl should reference spec/research docs; "
                "agents read code themselves"
            )
            print(f"  {colored(warning_message, Colors.YELLOW)}")

    if errors == 0 and not entries:
        # Seed-only / empty manifest: sub-agents dispatched for this task
        # would run with zero spec context (#573). Silent-green here is how
        # more than half the tasks in the report ended up uncurated.
        action = file_name.split(".", 1)[0]
        print(
            f"  {colored(f'{file_name}: ✗ (0 curated entries — sub-agents would get zero spec context)', Colors.RED)}"
        )
        print(
            f"    Curate it:  python3 .trellis/scripts/task.py add-context <task> {action} <path> \"<why>\""
        )
        print(
            "    Intentionally empty? Bypass at start: task.py start <task> --allow-empty-context"
        )
        return 1

    if errors == 0 and task_dir is not None:
        role = jsonl_file.stem
        projection = project_agent_context(
            repo_root, task_dir, role, get_context_injection_limits(repo_root)
        )
        for issue in projection.issues:
            line_label = str(issue.line) if issue.line is not None else "artifact"
            message = (
                f"{file_name}:{line_label}: role={issue.role} source={issue.category} "
                f"path={issue.path}: cannot be injected in full — {issue.reason}"
            )
            print(f"  {colored(message, Colors.RED)}")
            errors += 1

    if errors == 0:
        print(f"  {colored(f'{file_name}: ✓ ({len(entries)} entries)', Colors.GREEN)}")
    else:
        print(f"  {colored(f'{file_name}: ✗ ({errors} errors)', Colors.RED)}")

    return errors


# =============================================================================
# Command: list-context
# =============================================================================

def cmd_list_context(args: argparse.Namespace) -> int:
    """List JSONL context entries."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    if target_dir is None or not target_dir.is_dir():
        print(colored("Error: task directory required", Colors.RED))
        return 1

    print(colored("=== Context Files ===", Colors.BLUE))
    print()

    for jsonl_name in ["implement.jsonl", "check.jsonl"]:
        jsonl_file = target_dir / jsonl_name
        if not jsonl_file.is_file():
            continue

        print(colored(f"[{jsonl_name}]", Colors.CYAN))

        count = 0
        curated = False
        for line in jsonl_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            file_path = data.get("file") or data.get("path")
            if not file_path:
                # Placeholder / comment row — don't count as a real entry
                continue
            curated = True

            count += 1
            entry_type = data.get("type", "file")
            reason = data.get("reason", "-")

            if entry_type == "directory":
                print(f"  {colored(f'{count}.', Colors.GREEN)} [DIR] {file_path}")
            else:
                print(f"  {colored(f'{count}.', Colors.GREEN)} {file_path}")
            print(f"     {colored('→', Colors.YELLOW)} {reason}")

        if not curated:
            print(f"  {colored('(no curated entries yet)', Colors.YELLOW)}")

        print()

    return 0
