#!/usr/bin/env python3
"""Create and validate durable artifacts for one bounded Trellis subnode.

The coordinator creates an immutable brief before dispatching a subnode. The
subnode appends its worklog and writes its own final report. This helper never
dispatches workers, decides acceptance, or mutates task state.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, NoReturn

from common.io import write_text_atomic
from common.paths import get_repo_root, get_tasks_dir
from common.task_utils import is_within_tasks_dir, resolve_task_dir
from common.tasks import load_task


SCHEMA_VERSION = 1
MAX_DRAFT_BYTES = 64 * 1024
MAX_REPORT_BYTES = 128 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
)


class ArtifactError(Exception):
    """A user-correctable artifact validation failure."""


def _fail(message: str) -> NoReturn:
    raise ArtifactError(message)


def _read_json_object(path: Path, max_bytes: int, label: str) -> tuple[dict[str, Any], bytes]:
    """Read one bounded, non-symlink JSON object."""
    if path.is_symlink():
        _fail(f"refusing symlinked {label}: {path}")
    try:
        size = path.stat().st_size
    except OSError as exc:
        _fail(f"could not stat {label} {path}: {exc}")
    if size > max_bytes:
        _fail(f"{label} exceeds the {max_bytes} byte limit: {path}")
    try:
        raw = path.read_bytes()
        data = json.loads(raw.decode("utf-8"))
    except FileNotFoundError:
        _fail(f"{label} does not exist: {path}")
    except UnicodeDecodeError:
        _fail(f"{label} is not UTF-8: {path}")
    except json.JSONDecodeError as exc:
        _fail(f"{label} is not valid JSON: {path}: {exc.msg}")
    except OSError as exc:
        _fail(f"could not read {label} {path}: {exc}")
    if not isinstance(data, dict):
        _fail(f"{label} must contain a JSON object: {path}")
    return data, raw


def _require_text(value: Any, field: str, *, max_len: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{field} must be a non-empty string")
    if len(value) > max_len or "\x00" in value:
        _fail(f"{field} is not a bounded text value")
    return value


def _require_text_list(value: Any, field: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        _fail(f"{field} must be {'a list' if allow_empty else 'a non-empty list'}")
    result: list[str] = []
    for index, item in enumerate(value):
        result.append(_require_text(item, f"{field}[{index}]"))
    return result


def _require_id(value: Any, field: str) -> str:
    text = _require_text(value, field, max_len=64)
    if not ID_RE.fullmatch(text):
        _fail(f"{field} must match {ID_RE.pattern}")
    return text


def _reject_obvious_secrets(raw: bytes, label: str) -> None:
    text = raw.decode("utf-8", errors="replace")
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            _fail(f"{label} appears to contain a credential; remove it before writing the artifact")


def _task_id(task_dir: Path) -> str:
    task = load_task(task_dir)
    if task is None:
        _fail(f"task.json is missing or invalid: {task_dir}")
    task_id = task.raw.get("id") or task.dir_name
    if not isinstance(task_id, str) or not task_id.strip():
        _fail(f"task has no usable id: {task_dir}")
    if task.status not in {"planning", "in_progress"}:
        _fail(f"task is not active (planning or in_progress): {task_dir}")
    return task_id


def _task_lexical_from_resolved(task_resolved: Path, repo_root: Path) -> Path:
    tasks_lexical = get_tasks_dir(repo_root)
    try:
        relative = task_resolved.relative_to(tasks_lexical.resolve())
    except ValueError:
        _fail(f"task is outside the Trellis task directory: {task_resolved}")
    return tasks_lexical / relative


def _assert_no_subpath_symlinks(task_dir: Path, target: Path) -> None:
    """Reject symlinks below a task while permitting a symlinked .trellis root."""
    if task_dir.is_symlink():
        _fail(f"refusing symlinked task directory: {task_dir}")
    try:
        parts = target.relative_to(task_dir).parts
    except ValueError:
        _fail(f"artifact path is outside its task: {target}")
    current = task_dir
    for part in parts:
        current = current / part
        if current.is_symlink():
            _fail(f"refusing symlinked artifact path component: {current}")


def _node_dir(task_dir: Path, work_id: str, subnode_id: str) -> Path:
    return task_dir / "subnodes" / work_id / subnode_id


def _relative_to_repo(path: Path, repo_root: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        _fail(f"path is outside repository: {path}")


def _validate_snapshot(value: Any) -> None:
    if not isinstance(value, list) or not value:
        _fail("source_snapshot must be a non-empty list")
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            _fail(f"source_snapshot[{index}] must be an object")
        _require_text(item.get("locator"), f"source_snapshot[{index}].locator")
        _require_text(
            item.get("revision_or_digest"),
            f"source_snapshot[{index}].revision_or_digest",
        )
        _require_text(item.get("observed_at"), f"source_snapshot[{index}].observed_at")


def _validate_channel_ref(value: Any) -> None:
    if not isinstance(value, dict):
        _fail("channel_ref must be an object")
    _require_text(value.get("name"), "channel_ref.name", max_len=128)
    scope = _require_text(value.get("scope"), "channel_ref.scope", max_len=32)
    if scope not in {"project", "global"}:
        _fail("channel_ref.scope must be project or global")
    _require_text(value.get("worker_handle"), "channel_ref.worker_handle", max_len=128)


def _validate_retry_target(
    retry_of: Any,
    task_dir: Path,
    work_id: str,
    subnode_id: str,
) -> str | None:
    """Validate the coordinator's explicit, already-created retry source."""
    if retry_of is None:
        return None
    retry_id = _require_id(retry_of, "brief.retry_of")
    if retry_id == subnode_id:
        _fail("brief.retry_of must name a different subnode")
    target_dir = _node_dir(task_dir, work_id, retry_id)
    _assert_no_subpath_symlinks(task_dir, target_dir)
    target_brief_path = target_dir / "brief.json"
    if not target_brief_path.exists():
        _fail("brief.retry_of must identify an existing subnode brief in this task and work_id")
    target_brief, _raw = _read_json_object(
        target_brief_path,
        MAX_DRAFT_BYTES,
        "brief.retry_of target brief",
    )
    expected_task_id = _task_id(task_dir)
    if target_brief.get("schema_version") != SCHEMA_VERSION:
        _fail("brief.retry_of target brief has an unsupported schema_version")
    if target_brief.get("task_id") != expected_task_id:
        _fail("brief.retry_of target brief does not belong to this task")
    if target_brief.get("work_id") != work_id:
        _fail("brief.retry_of target brief does not belong to this work_id")
    if target_brief.get("subnode_id") != retry_id:
        _fail("brief.retry_of target brief identity does not match its artifact directory")
    if target_brief.get("role_id") != "subnode":
        _fail("brief.retry_of target brief.role_id must be subnode")
    return retry_id


def _validate_brief_data(
    brief: dict[str, Any],
    task_dir: Path,
    node_dir: Path,
    repo_root: Path,
) -> None:
    expected_task_id = _task_id(task_dir)
    if brief.get("schema_version") != SCHEMA_VERSION:
        _fail(f"brief.schema_version must be {SCHEMA_VERSION}")
    if brief.get("task_id") != expected_task_id:
        _fail("brief.task_id does not match task.json")
    work_id = _require_id(brief.get("work_id"), "brief.work_id")
    subnode_id = _require_id(brief.get("subnode_id"), "brief.subnode_id")
    if node_dir != _node_dir(task_dir, work_id, subnode_id):
        _fail("brief identity does not match its artifact directory")
    if brief.get("role_id") != "subnode":
        _fail("brief.role_id must be subnode")
    _require_text(brief.get("question"), "brief.question")
    _require_text(brief.get("independence_reason"), "brief.independence_reason")
    _require_text_list(brief.get("scope"), "brief.scope")
    _require_text_list(brief.get("protected_targets"), "brief.protected_targets", allow_empty=True)
    _require_text(brief.get("lens"), "brief.lens")
    _require_text(brief.get("evidence_method"), "brief.evidence_method")
    _validate_snapshot(brief.get("source_snapshot"))
    _require_text_list(brief.get("dependencies"), "brief.dependencies", allow_empty=True)
    _require_text_list(brief.get("stop_conditions"), "brief.stop_conditions")
    _require_text(brief.get("deadline"), "brief.deadline", max_len=128)
    _validate_channel_ref(brief.get("channel_ref"))
    if "retry_of" not in brief:
        _fail("brief.retry_of must be present; use null when this is not a retry")
    if "counter_of" not in brief:
        _fail("brief.counter_of must be present; use null when this is not counterwork")
    _validate_retry_target(
        brief["retry_of"],
        task_dir,
        work_id,
        subnode_id,
    )
    counter_of = brief["counter_of"]
    if counter_of is not None:
        counter_id = _require_id(counter_of, "brief.counter_of")
        if counter_id == subnode_id:
            _fail("brief.counter_of must name a different subnode")
    expected_report = _relative_to_repo(node_dir / "report.json", repo_root)
    if brief.get("report_path") != expected_report:
        _fail("brief.report_path does not match its immutable artifact directory")


def _resolve_artifact_file(
    value: str,
    expected_name: str,
    repo_root: Path,
) -> tuple[Path, Path, Path]:
    """Return lexical artifact, node directory, and task directory after checks."""
    supplied = Path(value)
    lexical = supplied if supplied.is_absolute() else repo_root / supplied
    if lexical.name != expected_name:
        _fail(f"expected a {expected_name} path, received: {value}")
    if lexical.is_symlink():
        _fail(f"refusing symlinked artifact: {lexical}")
    try:
        resolved = lexical.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        _fail(f"could not resolve artifact {lexical}: {exc}")
    node_resolved = resolved.parent
    work_resolved = node_resolved.parent
    subnodes_resolved = work_resolved.parent
    task_resolved = subnodes_resolved.parent
    if subnodes_resolved.name != "subnodes":
        _fail(f"artifact is not under a task subnodes directory: {lexical}")
    if not is_within_tasks_dir(task_resolved, repo_root):
        _fail(f"artifact task is not a direct active task: {lexical}")
    task_dir = _task_lexical_from_resolved(task_resolved, repo_root)
    expected = _node_dir(task_dir, work_resolved.name, node_resolved.name) / expected_name
    try:
        same_path = lexical.resolve() == expected.resolve()
    except (OSError, RuntimeError) as exc:
        _fail(f"could not verify artifact containment: {exc}")
    if not same_path:
        _fail(f"artifact path does not match its task-owned location: {lexical}")
    _assert_no_subpath_symlinks(task_dir, expected)
    return expected, expected.parent, task_dir


def _validate_brief_file(
    value: str,
    repo_root: Path,
) -> tuple[dict[str, Any], bytes, Path, Path, Path]:
    brief_path, node_dir, task_dir = _resolve_artifact_file(value, "brief.json", repo_root)
    brief, raw = _read_json_object(brief_path, MAX_DRAFT_BYTES, "brief")
    _reject_obvious_secrets(raw, "brief")
    _validate_brief_data(brief, task_dir, node_dir, repo_root)
    return brief, raw, brief_path, node_dir, task_dir


def _validate_evidence(value: Any) -> set[tuple[str, str]]:
    if not isinstance(value, list):
        _fail("report.evidence must be a list")
    identities: set[tuple[str, str]] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            _fail(f"report.evidence[{index}] must be an object")
        evidence_id = _require_text(item.get("id"), f"report.evidence[{index}].id", max_len=128)
        locator = _require_text(item.get("locator"), f"report.evidence[{index}].locator")
        _require_text(item.get("summary"), f"report.evidence[{index}].summary")
        identity = (evidence_id, locator)
        if identity in identities:
            _fail("report.evidence contains a duplicate evidence identity")
        identities.add(identity)
    return identities


def _validate_report_data(
    report: dict[str, Any],
    brief: dict[str, Any],
) -> set[tuple[str, str]]:
    if report.get("schema_version") != SCHEMA_VERSION:
        _fail(f"report.schema_version must be {SCHEMA_VERSION}")
    for field in ("task_id", "work_id", "subnode_id", "role_id"):
        if report.get(field) != brief.get(field):
            _fail(f"report.{field} does not match brief.{field}")
    if report.get("scope") != brief.get("scope"):
        _fail("report.scope does not match brief.scope")
    if report.get("lens") != brief.get("lens"):
        _fail("report.lens does not match brief.lens")
    status = report.get("status")
    if status not in {"complete", "blocked", "incomplete", "error"}:
        _fail("report.status must be complete, blocked, incomplete, or error")
    evidence = _validate_evidence(report.get("evidence"))
    for field in ("findings", "uncertainties", "corrections"):
        if not isinstance(report.get(field), list):
            _fail(f"report.{field} must be a list")
    if status == "complete" and not evidence:
        _fail("a complete report requires at least one evidence item")
    if status != "complete":
        _require_text_list(report.get("completed_scope"), "report.completed_scope")
        _require_text(report.get("blocker"), "report.blocker")
    return evidence


def _validate_report_file(
    value: str,
    repo_root: Path,
) -> tuple[dict[str, Any], set[tuple[str, str]], dict[str, Any], Path]:
    report_path, node_dir, _task_dir = _resolve_artifact_file(value, "report.json", repo_root)
    brief_path = node_dir / "brief.json"
    brief, _brief_raw, _brief_path, _brief_node, _brief_task = _validate_brief_file(
        str(brief_path), repo_root
    )
    expected_report = _relative_to_repo(report_path, repo_root)
    if brief.get("report_path") != expected_report:
        _fail("brief.report_path does not point to the report being validated")
    report, raw = _read_json_object(report_path, MAX_REPORT_BYTES, "report")
    _reject_obvious_secrets(raw, "report")
    evidence = _validate_report_data(report, brief)
    return report, evidence, brief, node_dir


def _init(args: argparse.Namespace) -> None:
    repo_root = get_repo_root()
    task_dir = resolve_task_dir(args.task, repo_root)
    if task_dir is None or not is_within_tasks_dir(task_dir, repo_root):
        _fail("--task must identify a direct active task directory")
    if task_dir.is_symlink():
        _fail(f"refusing symlinked task directory: {task_dir}")
    work_id = _require_id(args.work_id, "--work-id")
    subnode_id = _require_id(args.subnode_id, "--subnode-id")
    node_dir = _node_dir(task_dir, work_id, subnode_id)
    _assert_no_subpath_symlinks(task_dir, node_dir)
    if node_dir.exists() or node_dir.is_symlink():
        _fail(f"subnode artifacts already exist: {node_dir}")
    draft_path = Path(args.draft)
    if not draft_path.is_absolute():
        draft_path = repo_root / draft_path
    draft, raw = _read_json_object(draft_path, MAX_DRAFT_BYTES, "brief draft")
    _reject_obvious_secrets(raw, "brief draft")
    expected_task_id = _task_id(task_dir)
    brief = dict(draft)
    brief["schema_version"] = SCHEMA_VERSION
    brief["task_id"] = expected_task_id
    brief["work_id"] = work_id
    brief["subnode_id"] = subnode_id
    brief["role_id"] = "subnode"
    brief["report_path"] = _relative_to_repo(node_dir / "report.json", repo_root)
    _validate_brief_data(brief, task_dir, node_dir, repo_root)
    for directory in (task_dir / "subnodes", task_dir / "subnodes" / work_id, node_dir):
        if directory.is_symlink():
            _fail(f"refusing symlinked artifact directory: {directory}")
        if directory.exists() and not directory.is_dir():
            _fail(f"artifact path component is not a directory: {directory}")
        try:
            directory.mkdir(exist_ok=True)
        except OSError as exc:
            _fail(f"could not create artifact directory {directory}: {exc}")
    brief_path = node_dir / "brief.json"
    worklog_path = node_dir / "worklog.md"
    brief_text = json.dumps(brief, indent=2, ensure_ascii=False) + "\n"
    worklog_text = (
        "# Subnode Worklog\n\n"
        f"- Task: `{brief['task_id']}`\n"
        f"- Work: `{work_id}`\n"
        f"- Subnode: `{subnode_id}`\n\n"
        "Append substantive observations, corrections, blockers, and completion notes below.\n"
    )
    if not write_text_atomic(brief_path, brief_text):
        _fail(f"could not write immutable brief: {brief_path}")
    if not write_text_atomic(worklog_path, worklog_text):
        _fail(f"could not write subnode worklog: {worklog_path}")
    print(json.dumps({
        "brief": _relative_to_repo(brief_path, repo_root),
        "worklog": _relative_to_repo(worklog_path, repo_root),
        "report": brief["report_path"],
    }))


def _validate(args: argparse.Namespace) -> None:
    repo_root = get_repo_root()
    report, _evidence, _brief, _node_dir_value = _validate_report_file(args.report, repo_root)
    print(f"Validated pending-review report: {report['subnode_id']}")


def _validate_counter(args: argparse.Namespace) -> None:
    repo_root = get_repo_root()
    primary_dir = Path(args.primary)
    counter_dir = Path(args.counter)
    if not primary_dir.is_absolute():
        primary_dir = repo_root / primary_dir
    if not counter_dir.is_absolute():
        counter_dir = repo_root / counter_dir
    primary_report, primary_evidence, primary_brief, primary_node = _validate_report_file(
        str(primary_dir / "report.json"), repo_root
    )
    counter_report, counter_evidence, counter_brief, counter_node = _validate_report_file(
        str(counter_dir / "report.json"), repo_root
    )
    if primary_node == counter_node:
        _fail("counter validation requires two different subnode directories")
    if primary_brief["task_id"] != counter_brief["task_id"]:
        _fail("counter subnode must belong to the same task")
    if primary_brief["work_id"] != counter_brief["work_id"]:
        _fail("counter subnode must belong to the same work_id")
    if counter_brief.get("counter_of") != primary_brief["subnode_id"]:
        _fail("counter brief.counter_of must identify the primary subnode")
    if primary_brief["lens"] == counter_brief["lens"]:
        _fail("counter subnode must use a different lens")
    if primary_report["status"] != "complete" or counter_report["status"] != "complete":
        _fail("counter comparison requires two complete reports")
    if primary_evidence & counter_evidence:
        _fail("counter report must use evidence identities independent of the primary report")
    print(
        "Validated independent counter reports: "
        f"{primary_brief['subnode_id']} and {counter_brief['subnode_id']}"
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="create immutable brief and empty worklog")
    init.add_argument("--task", required=True, help="direct active Trellis task directory")
    init.add_argument("--work-id", required=True)
    init.add_argument("--subnode-id", required=True)
    init.add_argument("--draft", required=True, help="coordinator-owned brief draft JSON")
    init.set_defaults(handler=_init)

    validate = subparsers.add_parser("validate", help="validate a pending-review report")
    validate.add_argument("--report", required=True)
    validate.set_defaults(handler=_validate)

    counter = subparsers.add_parser(
        "validate-counter",
        help="validate two completed, independent subnode directories",
    )
    counter.add_argument("--primary", required=True, help="primary subnode artifact directory")
    counter.add_argument("--counter", required=True, help="counter subnode artifact directory")
    counter.set_defaults(handler=_validate_counter)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        args.handler(args)
    except ArtifactError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
