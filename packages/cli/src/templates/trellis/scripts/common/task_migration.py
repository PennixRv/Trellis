"""Digest-guarded, reversible migration of legacy task planning metadata."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .io import write_text_atomic
from .ownership_record import assert_task_mutation_allowed
from .task_planning import REPLAN_STAGES


class MigrationError(ValueError):
    """A migration manifest, precondition, or receipt is unsafe or stale."""


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _read_object(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        data = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MigrationError(f"{label} is unreadable or invalid JSON: {path}") from exc
    if not isinstance(data, dict):
        raise MigrationError(f"{label} must contain a JSON object: {path}")
    return data, raw


def _task_path(repo_root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise MigrationError("manifest task path must be a project-relative POSIX path")
    relative = Path(value)
    if relative.is_absolute() or relative.parts[:2] != (".trellis", "tasks") or len(relative.parts) != 3:
        raise MigrationError(f"migration only accepts direct active tasks: {value!r}")
    tasks_dir = repo_root / ".trellis" / "tasks"
    if (repo_root / ".trellis").is_symlink() or tasks_dir.is_symlink() or relative.parts[2] in {"", ".", "..", "archive"}:
        raise MigrationError(f"unsafe task path: {value!r}")
    target = repo_root / relative
    if target.is_symlink() or not target.is_dir() or target.resolve().parent != tasks_dir.resolve():
        raise MigrationError(f"task path is missing, linked, or outside active tasks: {value!r}")
    return target


def _load_manifest(repo_root: Path, manifest_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest, raw = _read_object(manifest_path, "migration manifest")
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("tasks"), list) or not manifest["tasks"]:
        raise MigrationError("migration manifest requires schema_version=1 and a non-empty tasks array")
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in manifest["tasks"]:
        if not isinstance(entry, dict):
            raise MigrationError("each migration task entry must be an object")
        task_value = entry.get("path")
        if not isinstance(task_value, str):
            raise MigrationError("manifest task path must be a string")
        task_dir = _task_path(repo_root, task_value)
        if task_value in seen:
            raise MigrationError(f"duplicate migration task path: {task_value}")
        seen.add(task_value)
        digests = entry.get("source_digests")
        target = entry.get("target")
        if not isinstance(digests, dict) or "task.json" not in digests or not isinstance(target, dict):
            raise MigrationError(f"{task_value}: source_digests.task.json and target are required")
        if any(not isinstance(name, str) or Path(name).name != name or not isinstance(value, str) or len(value) != 64 for name, value in digests.items()):
            raise MigrationError(f"{task_value}: source digests must map filenames to SHA-256 hex digests")
        if any(any(c not in "0123456789abcdef" for c in value) for value in digests.values()):
            raise MigrationError(f"{task_value}: source digests must be lowercase SHA-256 hex")
        execution = target.get("execution_class")
        delivery = target.get("delivery_mode")
        stage = target.get("stage")
        if "stage" not in target:
            raise MigrationError(f"{task_value}: target must explicitly set stage to a stage or null")
        if execution not in ("planned", "direct") or delivery not in ("change_bearing", "analysis_only"):
            raise MigrationError(f"{task_value}: target requires explicit execution_class and delivery_mode")
        if stage is not None and (not isinstance(stage, str) or stage not in REPLAN_STAGES):
            raise MigrationError(f"{task_value}: unsupported target stage: {stage!r}")
        task_data, task_bytes = _read_object(task_dir / "task.json", f"{task_value}/task.json")
        if task_data.get("status") == "planning" and stage != "intake":
            raise MigrationError(f"{task_value}: existing planning task must migrate to intake")
        if task_data.get("status") == "in_progress" and stage is not None:
            raise MigrationError(f"{task_value}: migration must not infer a stage for an in_progress task")
        if task_data.get("status") not in {"planning", "in_progress"}:
            raise MigrationError(f"{task_value}: only planning or in_progress tasks may migrate")
        for name, expected in digests.items():
            path = task_dir / name
            if path.is_symlink() or not path.is_file():
                raise MigrationError(f"{task_value}/{name}: source file is missing or linked")
            if _digest(path.read_bytes()) != expected:
                raise MigrationError(f"{task_value}/{name}: source digest changed")
        meta = task_data.get("meta", {})
        if not isinstance(meta, dict):
            raise MigrationError(f"{task_value}: task meta must be an object")
        if "planning" in meta:
            raise MigrationError(f"{task_value}: planning metadata already exists; refusing to overwrite it")
        before_meta = {key: meta.get(key) for key in ("execution_class", "delivery_mode", "planning") if key in meta}
        after_meta = {
            **meta,
            "execution_class": execution,
            "delivery_mode": delivery,
            "planning": {"revision": 1, **({"stage": stage} if stage else {})},
        }
        updated = {**task_data, "meta": after_meta}
        rows.append({
            "path": task_value,
            "task_dir": task_dir,
            "source_digests": digests,
            "before_bytes": task_bytes,
            "before_meta": before_meta,
            "after_meta": {key: after_meta[key] for key in ("execution_class", "delivery_mode", "planning")},
            "after_bytes": (json.dumps(updated, indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
        })
    return {"manifest_digest": _digest(raw)}, rows


def _check_sources(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        for name, expected in row["source_digests"].items():
            path = row["task_dir"] / name
            if path.is_symlink() or not path.is_file() or _digest(path.read_bytes()) != expected:
                raise MigrationError(f"{row['path']}/{name}: source digest changed")


def _write(path: Path, raw: bytes) -> None:
    if not write_text_atomic(path, raw.decode("utf-8")):
        raise MigrationError(f"atomic write failed: {path}")


def _receipt_path(repo_root: Path, value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = repo_root / path
    trellis_dir = (repo_root / ".trellis").resolve()
    if path.is_symlink() or not path.parent.exists() or not path.parent.resolve().is_relative_to(trellis_dir):
        raise MigrationError("receipt path must be a new regular file under .trellis/")
    if path.exists():
        raise MigrationError(f"refusing to overwrite migration receipt: {path}")
    return path


def migrate(repo_root: Path, manifest_path: Path, *, apply: bool, receipt_value: str | None = None) -> dict[str, Any]:
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise MigrationError("manifest must be a regular file")
    manifest, rows = _load_manifest(repo_root, manifest_path)
    _check_sources(rows)
    preview = [{"path": row["path"], "before": row["before_meta"], "after": row["after_meta"]} for row in rows]
    if not apply:
        return {"mode": "dry_run", "manifest_digest": manifest["manifest_digest"], "tasks": preview}
    if not receipt_value:
        raise MigrationError("--apply requires --receipt under .trellis/")
    receipt_path = _receipt_path(repo_root, receipt_value)
    receipt = {
        "schema_version": 1,
        "manifest_digest": manifest["manifest_digest"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tasks": [],
    }
    for row in rows:
        assert_task_mutation_allowed(repo_root, row["task_dir"])
    written: list[dict[str, Any]] = []
    try:
        # Recheck every source before the first write to avoid partial migration on stale input.
        _check_sources(rows)
        for row in rows:
            target = row["task_dir"] / "task.json"
            _write(target, row["after_bytes"])
            entry = {
                "path": row["path"],
                "before_task_json": row["before_bytes"].decode("utf-8"),
                "after_digest": _digest(row["after_bytes"]),
            }
            receipt["tasks"].append(entry)
            written.append(row)
        receipt_raw = (json.dumps(receipt, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        _write(receipt_path, receipt_raw)
    except Exception:
        restore_errors: list[str] = []
        for row in reversed(written):
            try:
                _write(row["task_dir"] / "task.json", row["before_bytes"])
            except Exception as exc:  # report if a disk failure also blocks recovery
                restore_errors.append(f"{row['path']}: {exc}")
        if restore_errors:
            raise MigrationError("migration failed and rollback was incomplete: " + "; ".join(restore_errors))
        raise
    return {"mode": "applied", "receipt": receipt_path.relative_to(repo_root).as_posix(), "tasks": preview}


def rollback(repo_root: Path, receipt_path: Path) -> dict[str, Any]:
    trellis_dir = (repo_root / ".trellis").resolve()
    if (repo_root / ".trellis").is_symlink() or receipt_path.is_symlink() or not receipt_path.is_file() or not receipt_path.resolve().is_relative_to(trellis_dir):
        raise MigrationError("receipt must be a regular file")
    receipt, _raw = _read_object(receipt_path, "migration receipt")
    rows = receipt.get("tasks")
    if receipt.get("schema_version") != 1 or not isinstance(rows, list) or not rows:
        raise MigrationError("migration receipt has an unsupported format")
    prepared: list[tuple[Path, bytes, bytes]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str) or row["path"] in seen:
            raise MigrationError("migration receipt contains an invalid or duplicate task")
        seen.add(row["path"])
        task_dir = _task_path(repo_root, row["path"])
        before = row.get("before_task_json")
        after_digest = row.get("after_digest")
        if not isinstance(before, str) or not isinstance(after_digest, str):
            raise MigrationError(f"{row['path']}: receipt is missing rollback data")
        current_path = task_dir / "task.json"
        if current_path.is_symlink():
            raise MigrationError(f"{row['path']}/task.json: symlinked task.json refused")
        current = current_path.read_bytes()
        if _digest(current) != after_digest:
            raise MigrationError(f"{row['path']}/task.json: changed since migration; refusing rollback")
        prepared.append((current_path, current, before.encode("utf-8")))
    for path, _current, _before in prepared:
        assert_task_mutation_allowed(repo_root, path.parent)
    restored: list[tuple[Path, bytes]] = []
    try:
        for path, current, before in prepared:
            _write(path, before)
            restored.append((path, current))
    except Exception:
        for path, current in reversed(restored):
            _write(path, current)
        raise
    return {"mode": "rolled_back", "tasks": [row["path"] for row in rows]}
