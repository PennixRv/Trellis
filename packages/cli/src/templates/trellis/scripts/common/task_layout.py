"""Task status directories and bounded discovery (never recurse into task content)."""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import date
from pathlib import Path

STATUSES = ("planning", "in_progress", "completed", "cancelled")
MONTH_RE = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")


def task_location(tasks_dir: Path, name: str, status: str, month: str | None = None) -> Path:
    if not name or name in {".", "..", "archive", *STATUSES} or "/" in name or "\\" in name:
        raise ValueError(f"Invalid task directory name: {name}")
    if status not in STATUSES:
        raise ValueError(f"Invalid task status: {status}")
    if status == "completed":
        month = month or date.today().strftime("%Y-%m")
        if not MONTH_RE.fullmatch(month):
            raise ValueError(f"Invalid completion month: {month}")
        return tasks_dir / status / month / name
    return tasks_dir / status / name


def task_status_dir(task_dir: Path, tasks_dir: Path) -> str | None:
    """Validate exact depth, containment and nested symlinks; allow a shared tasks root."""
    try:
        relative = task_dir.absolute().relative_to(tasks_dir.absolute())
        parts = relative.parts
        valid = (len(parts) == 2 and parts[0] in {"planning", "in_progress", "cancelled"}) or (
            len(parts) == 3 and parts[0] == "completed" and MONTH_RE.fullmatch(parts[1])
        )
        if not valid:
            return None
        current = tasks_dir
        for part in parts:
            current /= part
            if current.is_symlink():
                return None
        task_dir.resolve().relative_to(tasks_dir.resolve())
        return parts[0]
    except (ValueError, OSError, RuntimeError):
        return None


def iter_task_dirs(tasks_dir: Path, *, legacy: bool = False) -> Iterator[Path]:
    """Enumerate only the prescribed levels; old layout is migration input only."""
    if not tasks_dir.is_dir():
        return
    candidates: list[Path] = []
    for entry in sorted(tasks_dir.iterdir()):
        if entry.is_symlink():
            raise ValueError(f"Symlink in task layout: {entry}")
        if not entry.is_dir():
            continue
        if entry.name in STATUSES:
            if entry.name == "completed":
                for month in sorted(entry.iterdir()):
                    if month.is_symlink() or not month.is_dir() or not MONTH_RE.fullmatch(month.name):
                        raise ValueError(f"Invalid completion month directory: {month}")
                    candidates.extend(month.iterdir())
            else:
                candidates.extend(entry.iterdir())
        elif legacy and entry.name == "archive":
            for month in sorted(entry.iterdir()):
                if month.is_symlink() or not month.is_dir() or not MONTH_RE.fullmatch(month.name):
                    raise ValueError(f"Invalid archive month directory: {month}")
                candidates.extend(month.iterdir())
        elif legacy:
            candidates.append(entry)
        else:
            raise ValueError(f"Old task layout at {entry}; run task.py migrate-layout")
    for candidate in sorted(candidates, key=lambda p: (p.name, str(p))):
        if candidate.is_symlink():
            raise ValueError(f"Symlink in task layout: {candidate}")
        if not candidate.is_dir():
            raise ValueError(f"Invalid task directory: {candidate}")
        yield candidate
