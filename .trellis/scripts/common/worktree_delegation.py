"""Versioned controller-only worktree delegation; Paseo owns native resources."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid
from typing import NoReturn

from .io import read_json_checked, write_json, write_text_atomic
from .paths import get_repo_root

MAX_BYTES = 256 * 1024
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def fail(message: str) -> NoReturn:
    from .task_workflow import TaskWorkflowError
    raise TaskWorkflowError("TASK_DELEGATE_WITHHELD", message)


def digest(value) -> str:
    data = value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(data).hexdigest()


def read(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        fail(f"invalid bounded regular JSON file: {path}")
    value, reason = read_json_checked(path)
    if value is None:
        fail(f"cannot read {path}: {reason}")
    return value


def save(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not write_json(path, value):
        fail(f"could not atomically save {path}; preserve current state")


def runtime_path(root: Path, task_id: str) -> Path:
    if not SAFE_ID.fullmatch(task_id):
        fail("unsafe task identity")
    path = root / ".trellis/.runtime/delegation" / task_id / "record.json"
    if path.resolve() != path.absolute():
        fail("redirected delegation runtime")
    return path


def resolve_record(root: Path, task_dir: Path, data: dict):
    """One resolver for current runtime and historical task-meta consumers."""
    path = runtime_path(root, task_dir.name)
    return read(path) if path.exists() else data.get("meta", {}).get("delegated_worktree_execution_record")


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf8", timeout=30)
    if result.returncode:
        fail(f"Git identity/check failed: {args[0]}")
    return result.stdout.strip()


def identity(root: Path) -> dict:
    root = root.resolve(strict=True)
    if Path(git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        fail("target must be the exact checkout root")
    return {"checkout": str(root), "common_dir": str(Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve())}


def task_inputs(child_dir: Path, *, require_authorization: bool = True):
    from .task_workflow import _load, _task_dir, _state, implementation_start_ready, TaskWorkflowError
    from .task_continuity import assert_task_mutation_allowed
    child, _ = _load(child_dir)
    if not child.get("parent"):
        fail("child must be linked to an authorized controller task")
    parent_dir = _task_dir(child["parent"])
    parent, meta = _load(parent_dir)
    if child.get("status") not in {"planning", "in_progress"}:
        raise TaskWorkflowError("TASK_DELEGATE_CHILD_TERMINAL", "child task is terminal")
    if child_dir.name not in parent.get("children", []):
        fail("child links or lifecycle are invalid")
    assert_task_mutation_allowed(get_repo_root(), parent_dir, parent)
    assert_task_mutation_allowed(get_repo_root(), child_dir, child)
    if require_authorization and (parent.get("status") != "in_progress" or not implementation_start_ready(parent, parent_dir)):
        raise TaskWorkflowError("TASK_DELEGATE_IMPLEMENTATION_NOT_AUTHORIZED", "current parent implementation authorization required")
    return child, parent, _state(meta), parent_dir


def file_ref(task_dir: Path, ref: str) -> Path:
    if not isinstance(ref, str) or not ref or Path(ref).is_absolute():
        fail("metadata reference must be a nonempty relative path")
    path = task_dir / ref
    try:
        path.resolve(strict=True).relative_to(task_dir.resolve())
    except (ValueError, OSError):
        fail("metadata reference must stay in the child task")
    if path.resolve() != path.absolute() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        fail("metadata reference must be a bounded regular file")
    return path


def freeze(root: Path, child_dir: Path, target: Path, branch: str | None, integration: str, settings_ref: str, requirements_ref: str, base_commit: str | None = None) -> dict:
    child, parent, state, _ = task_inputs(child_dir)
    target_identity = identity(target)
    settings_path, requirements_path = file_ref(child_dir, settings_ref), file_ref(child_dir, requirements_ref)
    settings, requirements = read(settings_path), read(requirements_path)
    if settings.get("version") != 1 or settings.get("provider") != "codex" or settings.get("mode") != "full-access" or not settings.get("model") or not settings.get("effort"):
        fail("settings v1 require explicit codex/model/effort/full-access; resolve defaults through capability first")
    if set(settings) - {"version", "provider", "model", "effort", "mode", "daemon_home", "sandbox", "approval", "reviewer", "context"}:
        fail("unknown settings field")
    if any(settings.get(k, "native_default") != "native_default" for k in ["sandbox", "approval", "reviewer", "context"]):
        fail("bottom-level permissions and context must retain native defaults")
    fields = {"version", "required_rules", "required_skills", "required_tools", "checks", "resources", "allowed_paths", "forbidden_paths", "setup_ref", "teamwork_permission"}
    if requirements.get("version") != 1 or set(requirements) - fields or not isinstance(requirements.get("allowed_paths"), list) or not requirements["allowed_paths"]:
        fail("requirements v1 and nonempty allowed_paths required")
    for key in fields - {"version", "setup_ref", "teamwork_permission"}:
        if key in requirements and (not isinstance(requirements[key], list) or any(not isinstance(item, str) or not item or "\0" in item for item in requirements[key])):
            fail(f"requirements {key} must contain nonempty strings")
    if requirements.get("teamwork_permission", "none") not in {"none", "read_only"}:
        fail("Teamwork may only be absent or read_only")
    if "setup_ref" in requirements:
        file_ref(child_dir, requirements["setup_ref"])
    if not isinstance(branch, str) or not branch:
        fail("child execution branch must be set through the native task interface")
    for ref in [settings_ref, requirements_ref, "prd.md"]:
        file_ref(child_dir, ref)
    git(target, "check-ref-format", "--branch", branch)
    git(target, "check-ref-format", "--branch", integration)
    if branch == integration:
        fail("execution branch must differ from integration branch")
    base = base_commit or git(target, "rev-parse", "--verify", "--end-of-options", f"{integration}^{{commit}}")
    git(target, "merge-base", "--is-ancestor", base, integration)
    role = file_ref(root, ".trellis/agents/delegated-worktree-primary-agent.md")
    node_method = file_ref(root, ".trellis/agents/worktree-delegation-node.md")
    authorization = state["implementation_authorization"]
    binding = {"format_version": 2, "parent_task_id": parent["id"], "child_task_id": child["id"], "parent_route_revision": state["task_route_revision"], "parent_contract_revision": authorization["contract_revision"], "approval_ref": authorization["approval_ref"], "target_locator": str(target), "integration_branch": integration, "execution_branch": branch, "base_commit": base, "contract_sha256": digest(file_ref(child_dir, "prd.md").read_bytes()), "role_sha256": digest(role.read_bytes()), "node_method_sha256": digest(node_method.read_bytes()), "setup_sha256": digest(file_ref(child_dir, requirements["setup_ref"]).read_bytes()) if requirements.get("setup_ref") else None, "settings_sha256": digest(settings_path.read_bytes()), "requirements_sha256": digest(requirements_path.read_bytes()), "settings_ref": settings_ref, "requirements_ref": requirements_ref}
    binding["binding_revision"] = digest(binding)
    return {"binding": binding, "target_identity": target_identity, "settings": settings, "requirements": requirements}


def adapter(record: dict, operation: str, payload: dict):
    request = {"version": 1, "operation": operation, "attempt_id": record.get("attempt_id"), "binding_revision": record.get("binding", {}).get("binding_revision"), "daemon_selector": {"home": record["settings"].get("daemon_home")} if record["settings"].get("daemon_home") else {}, "payload": payload}
    if record.get("daemon_identity"):
        request["daemon_selector"]["server_id"] = record["daemon_identity"]["server_id"]
    try:
        # A regular temp file bounds what the controller reads even if a broken
        # adapter emits excessive output. Never execute candidate-report commands.
        import tempfile
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            result = subprocess.run(["trellis-paseo-adapter"], input=json.dumps(request).encode(), stdout=output, stderr=errors, timeout=3700 if operation == "wait" else 120)
            output.seek(0)
            raw = output.read(MAX_BYTES + 1)
        value = json.loads(raw) if len(raw) <= MAX_BYTES else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        fail("adapter unavailable or outcome unknown; preserve intent and reconcile; install/check trellis-paseo-adapter through Lifecycle")
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("operation") != operation or value.get("attempt_id") != request["attempt_id"] or value.get("binding_revision") != request["binding_revision"]:
        fail("adapter response identity/shape unknown; preserve intent and reconcile")
    if result.returncode or value.get("ok") is not True or not isinstance(value.get("observations"), dict):
        fail(f"adapter {value.get('error', {}).get('category', 'outcome_unknown')}; inspect native resources before retry")
    observed = value["observations"]
    if record.get("daemon_identity") and observed.get("identity") != record["daemon_identity"]:
        fail("daemon identity changed; reconcile before continuing")
    return observed


def current(root: Path, child_dir: Path, *, require_authorization: bool = True) -> tuple[dict, Path]:
    path = runtime_path(root, child_dir.name)
    record = read(path)
    b = record["binding"]
    if not require_authorization:
        child, parent, _, _ = task_inputs(child_dir, require_authorization=False)
        if record.get("control_project_id") != digest(str(root).encode()) or b.get("parent_task_id") != parent["id"] or b.get("child_task_id") != child["id"] or b.get("binding_revision") != digest({k: v for k, v in b.items() if k != "binding_revision"}) or identity(Path(b["target_locator"])) != record.get("target_identity"):
            fail("existing controller/target binding identity does not match; preserve resources")
        return record, path
    if b.get("format_version") != 2:
        fail("incomplete legacy binding; inspect/interrupt and retain the old attempt before rebinding")
    frozen = freeze(root, child_dir, Path(b["target_locator"]), b["execution_branch"], b["integration_branch"], b["settings_ref"], b["requirements_ref"], b["base_commit"])
    if frozen != {k: record[k] for k in frozen}:
        fail("frozen input or target identity changed; preserve current attempt and rebind only after closure")
    return record, path


def assert_worktree(record: dict):
    tree = Path(record["worktree_path"])
    actual = identity(tree)
    if actual["common_dir"] != record["target_identity"]["common_dir"] or git(tree, "branch", "--show-current") != record["binding"]["execution_branch"]:
        fail("native worktree identity does not match current binding")
    git(tree, "merge-base", "--is-ancestor", record["binding"]["base_commit"], "HEAD")
    return tree


def projection(root: Path, child_dir: Path, record: dict, path: Path):
    b = record["binding"]
    sources = {"role": file_ref(root, ".trellis/agents/delegated-worktree-primary-agent.md"), "node_method": file_ref(root, ".trellis/agents/worktree-delegation-node.md"), "contract": file_ref(child_dir, "prd.md")}
    if record["requirements"].get("setup_ref"):
        sources["setup"] = file_ref(child_dir, record["requirements"]["setup_ref"])
    if b.get("format_version") != 2 or not SAFE_ID.fullmatch(record["attempt_id"]):
        fail("complete frozen binding and safe attempt identity required")
    snapshots = {}
    directory = path.parent / "inputs" / record["attempt_id"]
    if directory.resolve() != directory.absolute():
        fail("redirected frozen input directory")
    directory.mkdir(parents=True, exist_ok=True)
    for name, source in sources.items():
        content = source.read_bytes()
        if len(content) > MAX_BYTES or digest(content) != b[f"{name}_sha256"]:
            fail("approved source input changed before projection; preserve the attempt")
        snapshot = directory / f"{name}.md"
        if snapshot.exists() or snapshot.is_symlink():
            if snapshot.is_symlink() or not snapshot.is_file() or snapshot.stat().st_size > MAX_BYTES or digest(snapshot.read_bytes()) != b[f"{name}_sha256"]:
                fail("frozen input snapshot changed; preserve the attempt")
        elif not write_text_atomic(snapshot, content.decode("utf8"), newline=""):
            fail("could not save frozen input snapshot")
        snapshots[f"{name}_ref"] = str(snapshot)
    context = {"version": 1, "control_root": str(root), "control_task": str(child_dir), "record_ref": str(path), "attempt_id": record["attempt_id"], "binding_revision": b["binding_revision"], "binding": b, "workspace_id": record.get("workspace_id"), "agent_id": record.get("agent_id"), "target": record.get("worktree_path"), "execution_permission": record.get("execution_permission", "preparation"), **snapshots, "requirements": record["requirements"], "settings": record["settings"], "ready_path": str(Path(record["worktree_path"]) / ".trellis-delegation" / record["attempt_id"] / "ready.json"), "result_path": str(Path(record["worktree_path"]) / ".trellis-delegation" / record["attempt_id"] / "result.json")}
    save(path.with_name("context.json"), context)
    return path.with_name("context.json")


def candidate(record: dict, name: str, *, current_head=True):
    tree = assert_worktree(record)
    directory = tree / ".trellis-delegation" / record["attempt_id"]
    path = directory / f"{name}.json"
    if directory.resolve() != directory or (tree / ".trellis-delegation").is_symlink():
        fail("redirected candidate directory")
    if directory.exists() and any(p.name not in {"ready.json", "result.json", "blocked.json"} or p.is_symlink() or not p.is_file() or p.stat().st_size > MAX_BYTES for p in directory.iterdir()):
        fail("candidate directory contains unexpected data; preserve it")
    if not path.exists():
        return None
    value = read(path)
    b = record["binding"]
    expected = {"version": 1, "kind": name, "attempt_id": record["attempt_id"], "binding_revision": b["binding_revision"], "base_commit": b["base_commit"], "workspace_id": record["workspace_id"], "agent_id": record["agent_id"]}
    if any(value.get(k) != v for k, v in expected.items()) or (current_head and value.get("head_commit") != git(tree, "rev-parse", "HEAD")) or "acceptance" in value:
        fail("candidate identity/head/authority does not match the current attempt")
    if not isinstance(value.get("observations"), dict) or not isinstance(value.get("limitations"), list):
        fail("candidate observations/limitations are malformed")
    return value


def clean_result(record: dict, result: dict):
    tree = assert_worktree(record)
    base, head = record["binding"]["base_commit"], result["head_commit"]
    changed = git(tree, "diff", "--name-only", base, head).splitlines()
    commits = git(tree, "rev-list", f"{base}..{head}").splitlines()
    if set(changed) != set(result.get("changed_paths", [])) or set(commits) != set(result.get("source_commits", [])):
        fail("result commits/paths do not match native Git")
    import fnmatch
    req = record["requirements"]
    if any(p.startswith((".trellis-delegation/", ".trellis/tasks/", ".trellis/.runtime/")) or not any(fnmatch.fnmatchcase(p, a) for a in req["allowed_paths"]) or any(fnmatch.fnmatchcase(p, f) for f in req.get("forbidden_paths", [])) for p in changed):
        fail("source changes exceed the authorized paths")
    # No hidden committed runtime files, even if a later commit deletes them.
    for commit in commits:
        if git(tree, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", commit, "--", ".trellis-delegation", ".trellis/tasks", ".trellis/.runtime"):
            fail("source history modifies protected controller/runtime facts")
    dirty = git(tree, "status", "--porcelain", "--untracked-files=all").splitlines()
    allowed = {f"?? .trellis-delegation/{record['attempt_id']}/{name}.json" for name in ["ready", "result", "blocked"]}
    if any(line not in allowed for line in dirty):
        fail("source worktree has unpreserved changes")
    if not isinstance(result.get("checks"), list) or not isinstance(result.get("remaining"), list):
        fail("result checks/remaining required")
    return changed


def prepare_agent(root: Path, child_dir: Path, record: dict, path: Path):
    context = projection(root, child_dir, record, path)
    role = Path(read(context)["role_ref"]).read_text(encoding="utf8")
    if role.startswith("---\n"):
        role = role.split("\n---\n", 1)[1].lstrip("\n")
    codegraph = "codegraph" in record["requirements"].get("required_tools", [])
    tool = shutil.which("codegraph") if codegraph else None
    if codegraph and not tool:
        fail("required CodeGraph executable is unavailable to the controller")
    tool_payload = {"codegraph_command": str(Path(tool).resolve(strict=True))} if tool else {}
    record["intent"] = "prepare-agent"
    save(path, record)
    agent = adapter(record, "prepare-agent", {"workspace_id": record["workspace_id"], "cwd": record["worktree_path"], "model": record["settings"]["model"], "effort": record["settings"]["effort"], "role": role, "context": str(context), "prompt": f"prepare：读取 {context}，只准备并提交 ready.json；当前 agent_id 映射由主控落盘，身份不完整时只报告阻断。", "codegraph": codegraph, **tool_payload, "labels": {"trellis.control": record["control_project_id"], "trellis.child": record["binding"]["child_task_id"], "trellis.attempt": record["attempt_id"]}})["agent"]
    if not agent or not agent.get("id") or agent.get("workspaceId") != record["workspace_id"]:
        fail("agent creation outcome unknown; preserve intent")
    record.update({"agent_id": agent["id"], "status": "running", "intent": None})
    save(path, record)
    projection(root, child_dir, record, path)


def recover(root: Path, child_dir: Path, record: dict, path: Path, args):
    if not record.get("attempt_id") or not record.get("intent"):
        fail("recovery requires an unresolved attempt intent")
    workspace_id = args.workspace_id or record.get("workspace_id")
    if not workspace_id:
        fail("explicit native workspace-id required; inspect native resources first")
    observed = adapter(record, "inspect", {"target": record["binding"]["target_locator"], "workspace_id": workspace_id})
    spaces = observed.get("workspaces", [])
    if len(spaces) != 1 or spaces[0].get("id") != workspace_id or not spaces[0].get("workspaceDirectory"):
        fail("native workspace identity is unverified")
    adopted = {**record, "workspace_id": workspace_id, "worktree_path": str(Path(spaces[0]["workspaceDirectory"]).resolve())}
    assert_worktree(adopted)
    if record.get("workspace_id") and (record["workspace_id"] != workspace_id or record["worktree_path"] != adopted["worktree_path"]):
        fail("recovery cannot switch existing workspace mappings")
    agent_id = args.agent_id or record.get("agent_id")
    if agent_id:
        agents = [a for a in observed.get("agents", []) if a and a.get("id") == agent_id]
        if len(agents) != 1:
            fail("exact native agent-id not found; no fuzzy or prefix adoption")
        agent = agents[0]
        if agent.get("workspaceId") != workspace_id or Path(agent.get("cwd", "")).resolve() != Path(adopted["worktree_path"]) or agent.get("labels", {}).get("trellis.attempt") != record["attempt_id"] or agent.get("labels", {}).get("trellis.control") != record["control_project_id"]:
            fail("native agent labels/workspace/cwd do not match the pending attempt")
        if record.get("agent_id") and record["agent_id"] != agent_id:
            fail("recovery cannot replace an existing agent")
        adopted.update({"agent_id": agent_id, "status": "running"})
    elif record["intent"] == "prepare-agent" and args.delivery_evidence_ref:
        if any(a and a.get("labels", {}).get("trellis.attempt") == record["attempt_id"] for a in observed.get("agents", [])):
            fail("native attempt agent exists; map its exact ID instead of asserting absence")
        file_ref(child_dir, args.delivery_evidence_ref)
        adopted["status"] = "workspace_created"
    elif record["intent"] != "prepare-workspace":
        fail("unknown agent creation must be mapped before any new agent is created")
    else:
        adopted["status"] = "workspace_created"
    evidence = {"observation": observed, "intent": record["intent"]}
    if record["intent"] in {"send_pending", "interrupt_pending", "prepare-agent"} and (not agent_id or record["intent"] != "prepare-agent"):
        if not args.delivery_evidence_ref:
            fail("controller-owned native delivery/interrupt evidence required; idle alone cannot resolve unknown delivery")
        evidence["delivery_evidence"] = file_ref(child_dir, args.delivery_evidence_ref).read_text(encoding="utf8")
    if not args.execute:
        return {"status": "ready", "recovery": evidence, "adopted": adopted}
    if not args.reason or not args.approval_ref:
        fail("explicit recovery reason and existing approval reference required")
    adopted.setdefault("recovery_receipts", []).append({**evidence, "reason": args.reason, "approval_ref": args.approval_ref})
    adopted["intent"] = None
    save(path, adopted)
    projection(root, child_dir, adopted, path)
    return adopted


def wait_for_node(args):
    from .task_workflow import _task_dir, _task_lock
    from .task_move import layout_lock, require_settled_layout
    root = get_repo_root().resolve()
    with layout_lock(root):
        require_settled_layout(root)
        child_dir = _task_dir(args.child_task)
        with _task_lock(child_dir):
            task_inputs(child_dir)
            record, _ = current(root, child_dir)
            if not record.get("agent_id") or record["status"] == "retired":
                fail("wait requires a current mapped agent")
    # Long native waits must leave the controller free to inspect or interrupt.
    observations = adapter(record, "wait", {"agent_id": record["agent_id"], "cwd": record["worktree_path"], "timeout_ms": args.timeout_ms})
    with layout_lock(root):
        require_settled_layout(root)
        child_dir = _task_dir(args.child_task)
        with _task_lock(child_dir):
            task_inputs(child_dir)
            latest, _ = current(root, child_dir)
            if any(latest.get(k) != record.get(k) for k in ["binding", "attempt_id", "agent_id", "workspace_id", "worktree_path"]) or latest["status"] == "retired":
                fail("wait target changed; inspect current binding instead of using stale observations")
            reports = {name: candidate(latest, name, current_head=False) for name in ["ready", "result", "blocked"]}
            print(json.dumps({"record": latest, "observations": observations, "candidates": reports}, ensure_ascii=False))
    return 0


def run(args):
    from .task_workflow import _task_dir, _task_lock
    root = get_repo_root().resolve()
    child_dir = _task_dir(args.child_task)
    with _task_lock(child_dir):
        path = runtime_path(root, child_dir.name)
        operation = args.command.removeprefix("delegate-")
        if operation == "inspect":
            from .task_workflow import _load

            child, _ = _load(child_dir)
            if child.get("status") in {"completed", "cancelled"}:
                record = resolve_record(root, child_dir, child)
                print(json.dumps({"record": record, "historical": True,
                                  "observations": {}, "candidates": {}}, ensure_ascii=False))
                return 0
        if operation == "bind":
            if getattr(args, "result_path", None):
                fail("legacy --result-path cannot start protocol v1; reconcile old attempts first")
            child, _, _, _ = task_inputs(child_dir)
            previous = resolve_record(root, child_dir, child)
            if previous and previous.get("status") != "retired":
                fail("an existing attempt is not retired; inspect/reconcile instead of rebinding")
            if not args.target_repo or not args.integration_branch or not args.settings_ref or not args.requirements_ref:
                fail("explicit --target-repo, --integration-branch, --settings-ref and --requirements-ref required")
            record = freeze(root, child_dir, Path(args.target_repo).resolve(), child.get("branch"), args.integration_branch, args.settings_ref, args.requirements_ref)
            record.update({"status": "bound", "control_project_id": digest(str(root).encode()), "execution_permission": "preparation"})
            if previous:
                save(path.with_name(f"retired-{previous['attempt_id']}.json"), previous)
            save(path, record)
        else:
            safety_control = operation in {"inspect", "observe", "interrupt"} or (operation == "reconcile" and not args.recover and args.disposition == "retained")
            _, _, state, _ = task_inputs(child_dir, require_authorization=not safety_control)
            if operation == "start":
                admission = state.get("route_dependency_admission") or {}
                if admission.get("admission_state") != "ready":
                    from .task_workflow import TaskWorkflowError
                    raise TaskWorkflowError("TASK_DELEGATE_ADMISSION_REQUIRED", "current route dependency admission is not ready")
            record, path = current(root, child_dir, require_authorization=not safety_control)
            b = record["binding"]
            if operation == "start":
                if record["status"] == "workspace_created" and not record.get("intent"):
                    assert_worktree(record)
                    prepare_agent(root, child_dir, record, path)
                    print(json.dumps(record, ensure_ascii=False))
                    return 0
                if record["status"] != "bound":
                    fail("attempt already exists; use inspect/observe/reconcile without creating another writer")
                _, _, state, _ = task_inputs(child_dir)
                admission = state.get("route_dependency_admission") or {}
                if admission.get("admission_state") != "ready" or admission.get("task_route_revision") != state["task_route_revision"] or not admission.get("evidence_refs") or not {"pennix-lifecycle", "paseo", "git"}.issubset(admission.get("dependencies", [])):
                    fail("current evidenced Lifecycle/Paseo/Git admission is required")
                observed = adapter(record, "capability", {"cwd": b["target_locator"]})
                record["daemon_identity"] = observed["identity"]
                models = observed.get("models", [])
                modes = observed.get("modes", [])
                if isinstance(models, dict):
                    models = models.get("models", [])
                if isinstance(modes, dict):
                    modes = modes.get("modes", [])
                selected = next((m for m in models if m.get("id") == record["settings"]["model"]), None)
                if not selected or not any(m.get("id") == "full-access" for m in modes):
                    fail("requested Codex model/full-access mode is not available")
                options = selected.get("thinkingOptions", [])
                if not any(o.get("id") == record["settings"]["effort"] for o in options):
                    fail("requested effort is not supported by the selected model")
                existing = adapter(record, "inspect", {"target": b["target_locator"]})
                if existing.get("lifecycle", {}).get("autoArchiveAfterMerge") is not False:
                    fail("native autoArchiveAfterMerge must be explicitly disabled before delegation; preserve worktrees until owner closeout")
                for agent in existing.get("agents", []):
                    if agent and agent.get("status") not in {"closed", "idle"} and agent.get("cwd") and Path(agent["cwd"]).exists() and identity(Path(agent["cwd"]))["common_dir"] == record["target_identity"]["common_dir"] and git(Path(agent["cwd"]), "branch", "--show-current") == b["execution_branch"]:
                        fail("another target writer is active; reconcile before starting")
                if subprocess.run(["git", "show-ref", "--verify", "--quiet", f"refs/heads/{b['execution_branch']}"], cwd=b["target_locator"]).returncode != 1:
                    fail("execution branch already exists; do not create or reset it")
                for other in (root / ".trellis/.runtime/delegation").glob("*/record.json"):
                    if other != path:
                        item = read(other)
                        if item.get("target_identity") == record["target_identity"] and item.get("binding", {}).get("execution_branch") == b["execution_branch"] and item.get("status") not in {"bound", "retired"}:
                            fail("another controller record owns this target branch")
                record.update({"attempt_id": uuid.uuid4().hex, "status": "starting", "intent": "prepare-workspace"})
                save(path, record)
                workspace = adapter(record, "prepare-workspace", {"target": b["target_locator"], "branch": b["execution_branch"], "base_commit": b["base_commit"], "title": f"trellis-{record['attempt_id']}"})["workspace"]
                if not isinstance(workspace, dict) or not workspace.get("id") or not workspace.get("workspaceDirectory"):
                    fail("workspace creation outcome unknown; preserve intent")
                record.update({"workspace_id": workspace["id"], "worktree_path": str(Path(workspace["workspaceDirectory"]).resolve()), "status": "workspace_created"})
                save(path, record)
                assert_worktree(record)
                prepare_agent(root, child_dir, record, path)
            elif operation in {"inspect", "observe", "interrupt"}:
                if operation == "interrupt":
                    if record.get("intent"):
                        fail("resolve prior intent before interrupt; native emergency cancellation remains available")
                    record["intent"] = "interrupt_pending"
                    save(path, record)
                observations = adapter(record, "interrupt" if operation == "interrupt" else "observe" if record.get("agent_id") else "inspect", {"agent_id": record["agent_id"], "cwd": record["worktree_path"]} if record.get("agent_id") else {"target": b["target_locator"], **({"workspace_id": record["workspace_id"]} if record.get("workspace_id") else {})})
                if operation == "interrupt":
                    record.setdefault("interrupt_receipts", []).append(observations)
                    record["intent"] = None
                    save(path, record)
                reports = {name: candidate(record, name, current_head=False) for name in ["ready", "result", "blocked"]} if record.get("worktree_path") else {}
                print(json.dumps({"record": record, "observations": observations, "candidates": reports}, ensure_ascii=False))
                return 0
            elif operation in {"execute", "followup"}:
                if record.get("status") != "running" or not record.get("agent_id") or not record.get("workspace_id"):
                    fail("execute/followup requires a current running attempt; retired attempts cannot send")
                if record.get("intent"):
                    fail("prior creation/send outcome unresolved; inspect and reconcile first")
                observed = adapter(record, "observe", {"agent_id": record["agent_id"], "cwd": record["worktree_path"]})["agent"]
                runtime = observed.get("runtimeInfo") or {}
                if observed.get("activeTurn") or observed.get("status") != "idle" or runtime.get("modeId") != "full-access" or runtime.get("model") != record["settings"]["model"] or runtime.get("thinkingOptionId") != record["settings"]["effort"]:
                    fail("agent is active or settings are unverified/drifted")
                ready = candidate(record, "ready", current_head=operation == "execute")
                if not ready or ready.get("missing") != []:
                    fail("current ready candidate with no missing requirements required")
                record["ready_evidence"] = ready
                record["execution_permission"] = "implementation"
                context = projection(root, child_dir, record, path)
                message = f"{operation}：重新读取 {context}，按当前绑定与许可完成本包并提交 result.json。"
                if operation == "followup":
                    message += file_ref(child_dir, args.instructions_ref).read_text(encoding="utf8")
                record["intent"] = "send_pending"
                record["send_pending"] = {"client_message_id": str(uuid.uuid4()), "sha256": digest(message.encode())}
                save(path, record)
                receipt = adapter(record, operation, {"agent_id": record["agent_id"], "cwd": record["worktree_path"], "prompt": message, "client_message_id": record["send_pending"]["client_message_id"]})
                record.setdefault("followup_receipts", []).append({**record.pop("send_pending"), **receipt})
                record["intent"] = None
                save(path, record)
            elif operation == "reconcile":
                if args.recover:
                    print(json.dumps(recover(root, child_dir, record, path, args), ensure_ascii=False))
                    return 0
                if record.get("status") == "retired":
                    print(json.dumps(record, ensure_ascii=False)); return 0
                if not record.get("agent_id"):
                    fail("partial creation requires explicit native resource mapping before retirement; preserve intent")
                observation = adapter(record, "observe", {"agent_id": record["agent_id"], "cwd": record["worktree_path"]})
                agent = observation["agent"]
                if not agent or agent.get("activeTurn") or agent.get("status") not in {"idle", "closed"}:
                    fail("native writer is active or unknown")
                result = candidate(record, "result")
                if not result and args.disposition != "retained":
                    fail("bounded result and preserved source evidence required before retirement")
                if result:
                    clean_result(record, result)
                if args.disposition == "integrated":
                    if result is None:
                        fail("integrated closure requires a result")
                    git(Path(b["target_locator"]), "merge-base", "--is-ancestor", result["head_commit"], b["integration_branch"])
                tree = assert_worktree(record)
                evidence = {"result": result, "observation": observation, "disposition": args.disposition, "preserved_worktree": str(tree), "head_commit": git(tree, "rev-parse", "HEAD"), "git_status": git(tree, "status", "--porcelain", "--untracked-files=all")}
                if not args.execute:
                    print(json.dumps({"status": "ready", "evidence": evidence}, ensure_ascii=False)); return 0
                if not args.reason or not args.approval_ref or not args.writer_evidence_ref:
                    fail("reason, approval-ref and controller-owned writer-evidence-ref required; idle/cancel alone do not prove background writers stopped")
                evidence["writer_evidence"] = file_ref(child_dir, args.writer_evidence_ref).read_text(encoding="utf8")
                record.update({"status": "retired", "intent": None, "result_evidence": result, "closure_evidence": {**evidence, "reason": args.reason, "approval_ref": args.approval_ref}})
                save(path, record)
            else:
                fail("unsupported delegation operation")
        print(json.dumps(record, ensure_ascii=False))
        return 0


def node_context() -> dict | None:
    raw = os.environ.get("TRELLIS_DELEGATION_CONTEXT")
    if not raw:
        return None
    context = read(Path(raw))
    record = read(Path(context["record_ref"]))
    if context.get("version") != 1 or record.get("status") == "retired" or context.get("attempt_id") != record.get("attempt_id") or context.get("binding_revision") != record.get("binding", {}).get("binding_revision") or context.get("agent_id") != os.environ.get("PASEO_AGENT_ID") or not context.get("agent_id") or git(Path.cwd(), "rev-parse", "--show-toplevel") != str(Path(context.get("target", "")).resolve()):
        fail("delegated context/resource/cwd is missing, stale or mismatched; do not enter ordinary controller workflow")
    assert_worktree(record)
    if context.get("execution_permission") != record.get("execution_permission") or context.get("binding") != record.get("binding") or context.get("target") != record.get("worktree_path"):
        fail("delegated execution projection is stale")
    control = Path(context["control_task"])
    child = read(control / "task.json")
    from .task_utils import resolve_task_dir
    parent_dir = resolve_task_dir(child["parent"], Path(context["control_root"]))
    if parent_dir is None:
        fail("current parent task is missing")
    parent = read(parent_dir / "task.json")
    state = parent.get("meta", {}).get("task_workflow", {})
    b = record["binding"]
    auth = state.get("implementation_authorization") or {}
    if parent.get("status") != "in_progress" or state.get("current_phase_id") != "task_implementation" or state.get("task_route_revision") != b["parent_route_revision"] or auth.get("contract_revision") != b["parent_contract_revision"]:
        fail("parent authorization changed; stop delegated implementation")
    from .task_workflow import implementation_start_ready
    if not implementation_start_ready(parent, parent_dir):
        fail("parent implementation contract is no longer current")
    if b.get("format_version") != 2:
        fail("incomplete legacy binding; stop and ask the controller to retain/rebind")
    inputs = [(control, "prd.md", "contract"), (control, b["settings_ref"], "settings"), (control, b["requirements_ref"], "requirements"), (Path(context["control_root"]), ".trellis/agents/delegated-worktree-primary-agent.md", "role"), (Path(context["control_root"]), ".trellis/agents/worktree-delegation-node.md", "node_method")]
    if record["requirements"].get("setup_ref"):
        inputs.append((control, record["requirements"]["setup_ref"], "setup"))
    for directory, ref, name in inputs:
        key = f"{name}_sha256"
        if digest(file_ref(directory, ref).read_bytes()) != b[key]:
            fail("delegated input changed; wait for controller revalidation")
        if name not in {"settings", "requirements"}:
            expected = Path(context["record_ref"]).parent / "inputs" / record["attempt_id"] / f"{name}.md"
            if context.get(f"{name}_ref") != str(expected) or digest(file_ref(expected.parent, expected.name).read_bytes()) != b[key]:
                fail("delegated frozen snapshot is missing, redirected or stale")
    if context.get("requirements") != record["requirements"] or context.get("settings") != record["settings"]:
        fail("delegated inline inputs are stale")
    return context
