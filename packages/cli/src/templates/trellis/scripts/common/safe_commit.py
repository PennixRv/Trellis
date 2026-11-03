"""
Safe git-add helpers for Trellis-owned paths.

Why this module exists
----------------------
A real user incident: a project's `.gitignore` listed `.trellis/` (company-wide
template / personal habit). When `add_session.py` ran
their auto-commit and `git add` failed with `ignored by .gitignore`, the AI
agent driving the workflow "fixed" it by retrying with
`git add -f .trellis/` — which fan-out-included every ignored subtree
(`.trellis/.backup-*/`, `.trellis/worktrees/`, `.trellis/.template-hashes.json`,
`.trellis/.runtime/`), committing 548 files / 83474 lines of caches/backups.

Design
------
- Scripts only stage SPECIFIC product paths (journal files, index.md, and the
  current task dir). Never the whole `.trellis/` tree.
- If plain `git add <specific>` fails with "ignored by", DO NOT retry with
  ``-f``. The presence of `.trellis/` in `.gitignore` is treated as user
  intent ("keep .trellis/ local-only"). The script warns and skips the
  auto-commit; users who want auto-staging can either fix their `.gitignore`
  or set ``session_auto_commit: false`` and manage git themselves.
- The warning includes a negative example: ``Do NOT use `git add -f .trellis/` ...``
  so any AI rereading the log doesn't reinvent the bug.

History note: 0.5.10 introduced an automatic ``git add -f`` retry on the
specific paths. That was reverted in 0.5.11 — auto-forcing into a tree the
user had gitignored violates user intent even when the path list is narrow.
The wider-grain forbidden command stays forbidden, and the narrow-grain auto
``-f`` is gone too.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .git import run_git, run_git_retry_index_lock
from .paths import (
    DIR_TASKS,
    DIR_WORKFLOW,
    DIR_WORKSPACE,
    FILE_JOURNAL_PREFIX,
    get_developer,
)


# Paths under .trellis/ that must NEVER be auto-staged. Listed here so the
# warning to the user can show concrete subpaths to ignore individually
# instead of ignoring the whole `.trellis/` tree.
TRELLIS_IGNORED_SUBPATHS = (
    ".trellis/.backup-*",
    ".trellis/worktrees/",
    ".trellis/.template-hashes.json",
    ".trellis/.runtime/",
    ".trellis/.cache/",
)


def safe_trellis_paths_to_add(
    repo_root: Path,
    task_name: str | None = None,
) -> list[str]:
    """Return the list of repo-relative paths the auto-commit should stage.

    Only includes paths that exist on disk so callers don't pass non-existent
    arguments to git. The caller is responsible for `git diff --cached`
    checking afterwards.

    Included:
      - .trellis/workspace/<developer>/journal-*.md
      - .trellis/workspace/<developer>/index.md
      - .trellis/tasks/<task-dir>/   (ONLY the current task dir when
        ``task_name`` is passed)

    Excluded (intentionally — these must not be staged):
      - .trellis/.backup-*, .trellis/worktrees/,
        .trellis/.template-hashes.json, .trellis/.runtime/, .trellis/.cache/

    Scope contract (see #303 / break-loop analysis): when ``task_name`` is
    passed, the task segment stages ONLY that task directory — it never walks
    ``tasks_dir.iterdir()`` over all active tasks. This mirrors
    and prevents dirty changes in OTHER parallel-window task dirs from being
    bundled into the session auto-commit.

    With no ``task_name``, the function walks every direct task directory.
    New callers should always pass ``task_name``.
    """
    paths: list[str] = []

    # Workspace journal files + index.md
    developer = get_developer(repo_root)
    if developer:
        ws = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / developer
        if ws.is_dir():
            for f in sorted(ws.glob(f"{FILE_JOURNAL_PREFIX}*.md")):
                if f.is_file():
                    paths.append(
                        f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/{f.name}"
                    )
            index_md = ws / "index.md"
            if index_md.is_file():
                paths.append(
                    f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/index.md"
                )

    tasks_dir = repo_root / DIR_WORKFLOW / DIR_TASKS
    if not tasks_dir.is_dir():
        return paths

    if task_name is not None:
        # Narrow scope — ONLY the current task directory.
        # Never iterdir() all tasks: parallel-window dirty task dirs must not
        # leak into the session auto-commit.
        from .task_utils import find_task_by_name
        active_task = find_task_by_name(task_name, tasks_dir)
        if active_task is not None and active_task.is_dir():
            paths.append(active_task.relative_to(repo_root).as_posix())
        return paths

    # Wide scope (no task_name): each direct task directory.
    from .task_layout import iter_task_dirs
    for child in iter_task_dirs(tasks_dir):
        paths.append(child.relative_to(repo_root).as_posix())

    return paths


def _stderr_indicates_ignored(stderr: str) -> bool:
    """git add error indicates the path is excluded by .gitignore."""
    if not stderr:
        return False
    lowered = stderr.lower()
    return "ignored by" in lowered


def safe_git_add(
    paths: list[str], repo_root: Path, retry_on_index_lock: bool = False
) -> tuple[bool, bool, str]:
    """Run `git add` on specific paths; never retry with -f.

    Returns ``(success, used_force, stderr)``. The ``used_force`` field is
    kept for signature compatibility with the 0.5.10 implementation but is
    always ``False`` — we never auto-force.

    Behavior:
      - No paths passed → success, no force, empty stderr.
      - Plain ``git add -- <paths>`` succeeds → return success.
      - Plain fails (any reason — ignored or otherwise) → return failure with
        the stderr. Callers should inspect the stderr (see
        :func:`print_gitignore_warning`) and skip the auto-commit.

    ``retry_on_index_lock`` opts into the bounded backoff-retry for a held
    ``.git/index.lock`` (see :func:`~.git.run_git_retry_index_lock`). It is
    off by default; callers that already changed files on disk can opt in.
    """
    if not paths:
        return True, False, ""

    runner = run_git_retry_index_lock if retry_on_index_lock else run_git
    rc, _, err = runner(["add", "--", *paths], cwd=repo_root)
    if rc == 0:
        return True, False, ""
    return False, False, err


def print_gitignore_warning(paths: list[str]) -> None:
    """Explain to the user (and any AI reading the log) what to do.

    CRITICAL: includes the negative example
    ``Do NOT use `git add -f .trellis/``` — agents reading the warning are
    known to invent that command, which fans out to ignored caches/backups.
    """
    print(
        "[WARN] git add failed because .trellis/ paths are ignored by your .gitignore.",
        file=sys.stderr,
    )
    print(
        "[WARN] Skipping auto-commit. The journal/task files were still written to disk;",
        file=sys.stderr,
    )
    print(
        "[WARN] git was not touched.",
        file=sys.stderr,
    )
    print("[WARN]", file=sys.stderr)
    print(
        "[WARN] Trellis manages these specific paths and they should be tracked:",
        file=sys.stderr,
    )
    if paths:
        for p in paths:
            print(f"[WARN]   {p}", file=sys.stderr)
    else:
        print(
            "[WARN]   .trellis/workspace/<developer>/{journal-*.md,index.md}",
            file=sys.stderr,
        )
        print(
            "[WARN]   .trellis/tasks/<task-dir>/",
            file=sys.stderr,
        )
    print("[WARN]", file=sys.stderr)
    print(
        "[WARN] Recommended: change your .gitignore from `.trellis/` to specific",
        file=sys.stderr,
    )
    print(
        "[WARN] subpaths that should remain ignored, e.g.:",
        file=sys.stderr,
    )
    for sub in TRELLIS_IGNORED_SUBPATHS:
        print(f"[WARN]   {sub}", file=sys.stderr)
    print("[WARN]", file=sys.stderr)
    print(
        "[WARN] Or, if you intentionally keep .trellis/ local-only, set in",
        file=sys.stderr,
    )
    print(
        "[WARN] .trellis/config.yaml:",
        file=sys.stderr,
    )
    print(
        "[WARN]   session_auto_commit: false",
        file=sys.stderr,
    )
    print(
        "[WARN] so the scripts skip git entirely and you can review / commit",
        file=sys.stderr,
    )
    print(
        "[WARN] manually with `git status` / `git add` / `git commit`.",
        file=sys.stderr,
    )
    print("[WARN]", file=sys.stderr)
    print(
        "[WARN] Do NOT use `git add -f .trellis/` — it pulls in backups, worktrees,",
        file=sys.stderr,
    )
    print(
        "[WARN] and runtime caches that should never be committed.",
        file=sys.stderr,
    )
