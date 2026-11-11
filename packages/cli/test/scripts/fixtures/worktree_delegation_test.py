"""Real Git/filesystem boundaries; native phase authorization is tested separately."""
import argparse
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(sys.argv.pop(1)).resolve()))
from common import worktree_delegation as d
from common.task_workflow import TaskWorkflowError, _assert_delegated_record_closed


class Delegation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "independent source"
        self.target.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.com")
        (self.target / "source.py").write_text("value = 1\n")
        self.git("add", "source.py")
        self.git("-c", "commit.gpgsign=false", "commit", "-m", "base")
        self.child = self.root / ".trellis/tasks/planning/11-09-child"
        self.child.mkdir(parents=True)
        (self.child / "prd.md").write_text("contract\n")
        (self.child / "settings.json").write_text(json.dumps({"version": 1, "provider": "codex", "model": "native-model", "effort": "high", "mode": "full-access"}))
        (self.child / "requirements.json").write_text(json.dumps({"version": 1, "allowed_paths": ["source.py"], "required_tools": ["codegraph"]}))
        role = self.root / ".trellis/agents/delegated-worktree-primary-agent.md"
        role.parent.mkdir(parents=True)
        role.write_text("stable role\n")
        role.with_name("worktree-delegation-node.md").write_text("stable node method\n")
        self.auth = {"task_route_revision": "1", "implementation_authorization": {"contract_revision": "approved", "approval_ref": "approval.md"}}
        self.inputs = patch.object(d, "task_inputs", return_value=({"id": "child"}, {"id": "parent"}, self.auth, self.child.parent))
        self.inputs.start()
        self.addCleanup(self.inputs.stop)

    def git(self, *args, cwd=None):
        return subprocess.check_output(["git", *args], cwd=cwd or self.target, stderr=subprocess.PIPE, text=True).strip()

    def record(self):
        record = d.freeze(self.root, self.child, self.target, "node-branch", "main", "settings.json", "requirements.json")
        tree = self.root / "execution"
        self.git("worktree", "add", "-b", "node-branch", str(tree), "HEAD")
        record.update({"attempt_id": "a" * 32, "workspace_id": "workspace", "agent_id": "agent", "worktree_path": str(tree), "status": "running", "control_project_id": d.digest(str(self.root).encode()), "execution_permission": "preparation"})
        return record

    def report(self, record, kind="result"):
        report = {"version": 1, "kind": kind, "attempt_id": record["attempt_id"], "binding_revision": record["binding"]["binding_revision"], "base_commit": record["binding"]["base_commit"], "workspace_id": "workspace", "agent_id": "agent", "head_commit": self.git("rev-parse", "HEAD", cwd=record["worktree_path"]), "observations": {}, "limitations": [], "changed_paths": [], "source_commits": [], "checks": [], "remaining": []}
        directory = Path(record["worktree_path"]) / ".trellis-delegation" / record["attempt_id"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{kind}.json").write_text(json.dumps(report))
        return report

    def test_binding_freezes_target_and_inputs_without_initializing_target(self):
        first = d.freeze(self.root, self.child, self.target, "node-branch", "main", "settings.json", "requirements.json")
        self.assertFalse((self.target / ".trellis").exists())
        (self.child / "prd.md").write_text("changed contract\n")
        second = d.freeze(self.root, self.child, self.target, "node-branch", "main", "settings.json", "requirements.json")
        self.assertNotEqual(first["binding"]["binding_revision"], second["binding"]["binding_revision"])
        self.assertEqual(first["binding"]["role_sha256"], second["binding"]["role_sha256"])

    def test_refuses_unsafe_requirements_and_redirected_reports(self):
        (self.child / "requirements.json").write_text(json.dumps({"version": 1, "allowed_paths": [42]}))
        with self.assertRaises(TaskWorkflowError):
            self.record()
        (self.child / "requirements.json").write_text(json.dumps({"version": 1, "allowed_paths": ["source.py"]}))
        record = self.record()
        report = self.report(record)
        directory = Path(record["worktree_path"]) / ".trellis-delegation" / record["attempt_id"]
        (directory / "result.json").unlink()
        (self.root / "outside.json").write_text(json.dumps(report))
        (directory / "result.json").symlink_to(self.root / "outside.json")
        with self.assertRaises(TaskWorkflowError):
            d.candidate(record, "result")

    def test_freezes_setup_role_and_node_method_and_rejects_live_drift(self):
        setup = self.child / "setup.md"
        setup.write_bytes(b"approved preparation\r\n")
        requirements = json.loads((self.child / "requirements.json").read_text())
        requirements["setup_ref"] = setup.name
        (self.child / "requirements.json").write_text(json.dumps(requirements))
        record = self.record()
        path = d.runtime_path(self.root, self.child.name)
        d.save(path, record)
        context = d.read(d.projection(self.root, self.child, record, path))
        self.assertEqual(Path(context["setup_ref"]).read_bytes(), setup.read_bytes())
        for name, source in [("setup", setup), ("role", self.root / ".trellis/agents/delegated-worktree-primary-agent.md"), ("node_method", self.root / ".trellis/agents/worktree-delegation-node.md")]:
            with self.subTest(input=name):
                original = source.read_bytes()
                self.assertEqual(Path(context[f"{name}_ref"]).read_bytes(), original)
                self.assertNotEqual(context[f"{name}_ref"], str(source))
                source.write_text("changed input\n")
                changed = d.freeze(self.root, self.child, self.target, "node-branch", "main", "settings.json", "requirements.json")
                self.assertNotEqual(changed["binding"]["binding_revision"], record["binding"]["binding_revision"])
                with self.assertRaises(TaskWorkflowError):
                    d.current(self.root, self.child)
                with patch.object(d, "adapter") as native, self.assertRaises(TaskWorkflowError):
                    d.prepare_agent(self.root, self.child, record, path)
                native.assert_not_called()
                self.assertEqual(Path(context[f"{name}_ref"]).read_bytes(), original)
                source.write_bytes(original)
        Path(context["node_method_ref"]).write_text("tampered snapshot")
        with self.assertRaises(TaskWorkflowError):
            d.projection(self.root, self.child, record, path)

    def test_rejects_missing_oversized_redirected_and_legacy_inputs(self):
        directory = self.child / "real"
        directory.mkdir()
        (directory / "setup.md").write_text("setup")
        (self.child / "alias").symlink_to(directory, target_is_directory=True)
        for ref in ["missing.md", "alias/setup.md", str(directory / "setup.md"), 42]:
            with self.subTest(ref=ref), self.assertRaises(TaskWorkflowError):
                d.file_ref(self.child, ref)
        (directory / "setup.md").write_bytes(b"x" * (d.MAX_BYTES + 1))
        with self.assertRaises(TaskWorkflowError):
            d.file_ref(self.child, "real/setup.md")
        record = self.record()
        record["binding"]["format_version"] = 1
        d.save(d.runtime_path(self.root, self.child.name), record)
        with self.assertRaises(TaskWorkflowError):
            d.current(self.root, self.child)

    def test_retired_execute_and_followup_never_reach_adapter(self):
        record = self.record()
        record["status"] = "retired"
        d.save(d.runtime_path(self.root, self.child.name), record)
        for operation in ["execute", "followup"]:
            args = argparse.Namespace(command=f"delegate-{operation}", child_task=str(self.child))
            with self.subTest(operation=operation), patch.object(d, "get_repo_root", return_value=self.root), patch("common.task_workflow.get_repo_root", return_value=self.root), patch("common.task_workflow._task_dir", return_value=self.child), patch.object(d, "adapter") as native, self.assertRaises(TaskWorkflowError):
                d.run(args)
            native.assert_not_called()

    def test_node_rechecks_live_inputs_and_frozen_snapshot_before_work(self):
        record = self.record()
        path = d.runtime_path(self.root, self.child.name)
        d.save(path, record)
        context_path = d.projection(self.root, self.child, record, path)
        parent = self.root / ".trellis/tasks/in_progress/11-09-parent"
        parent.mkdir(parents=True)
        state = {**self.auth, "current_phase_id": "task_implementation"}
        d.save(parent / "task.json", {"id": "parent", "status": "in_progress", "meta": {"task_workflow": state}})
        d.save(self.child / "task.json", {"id": "child", "parent": str(parent)})
        with patch.dict(os.environ, {"TRELLIS_DELEGATION_CONTEXT": str(context_path), "PASEO_AGENT_ID": "agent"}), patch.object(Path, "cwd", return_value=Path(record["worktree_path"])), patch("common.task_workflow.implementation_start_ready", return_value=True):
            self.assertEqual(d.node_context()["attempt_id"], record["attempt_id"])
            for name in ["role", "node_method"]:
                source = self.root / ".trellis/agents" / ("delegated-worktree-primary-agent.md" if name == "role" else "worktree-delegation-node.md")
                original = source.read_text()
                source.write_text("updated project assets")
                with self.subTest(input=name), self.assertRaises(TaskWorkflowError):
                    d.node_context()
                source.write_text(original)
            context = d.read(context_path)
            Path(context["node_method_ref"]).write_text("modified snapshot")
            with self.assertRaises(TaskWorkflowError):
                d.node_context()

    def test_revoked_authorization_allows_only_bound_safety_controls(self):
        record = self.record()
        record["execution_permission"] = "implementation"
        path = d.runtime_path(self.root, self.child.name)
        d.save(path, record)
        # Drift must block new work without preventing cancellation/preservation.
        (self.child / "prd.md").write_text("revised contract")
        (self.child / "writer.md").write_text("controller verified background writers stopped")
        child = {"id": "child", "parent": "parent", "status": "planning"}
        parent = {"id": "parent", "status": "in_progress", "children": [self.child.name]}
        state = {**self.auth, "implementation_authorization": None}
        observation = {"agent": {"id": "agent", "activeTurn": None, "status": "idle"}}
        self.inputs.stop()
        try:
            with patch.object(d, "get_repo_root", return_value=self.root), patch("common.task_workflow.get_repo_root", return_value=self.root), patch("common.task_workflow._task_dir", side_effect=lambda p: self.child if str(p) == str(self.child) else self.child.parent / "parent"), patch("common.task_workflow._load", side_effect=lambda p: (child, {}) if p == self.child else (parent, {})), patch("common.task_workflow._state", return_value=state), patch("common.task_workflow.implementation_start_ready", return_value=False), patch("common.task_continuity.assert_task_mutation_allowed"), contextlib.redirect_stdout(io.StringIO()):
                for operation in ["inspect", "interrupt", "reconcile"]:
                    args = argparse.Namespace(command=f"delegate-{operation}", child_task=str(self.child), recover=False, disposition="retained", execute=True, reason="preserve revoked work", approval_ref="existing approval", writer_evidence_ref="writer.md")
                    with self.subTest(operation=operation), patch.object(d, "adapter", return_value=observation) as native:
                        self.assertEqual(d.run(args), 0)
                        self.assertTrue(native.called)
                self.assertEqual(d.read(path)["status"], "retired")
                self.assertEqual(d.read(path)["execution_permission"], "implementation")
                for operation in ["start", "execute", "followup"]:
                    args = argparse.Namespace(command=f"delegate-{operation}", child_task=str(self.child))
                    with self.subTest(operation=operation), patch.object(d, "adapter") as native, self.assertRaises(TaskWorkflowError):
                        d.run(args)
                    native.assert_not_called()
                for recover, disposition in [(True, "retained"), (False, "integrated")]:
                    args = argparse.Namespace(command="delegate-reconcile", child_task=str(self.child), recover=recover, disposition=disposition)
                    with patch.object(d, "adapter") as native, self.assertRaises(TaskWorkflowError):
                        d.run(args)
                    native.assert_not_called()
        finally:
            self.inputs.start()

    def test_result_requires_real_commits_scope_and_clean_source(self):
        record = self.record()
        report = self.report(record)
        self.assertEqual(d.clean_result(record, report), [])
        tree = Path(record["worktree_path"])
        (tree / "source.py").write_text("value = 2\n")
        with self.assertRaises(TaskWorkflowError):
            d.clean_result(record, report)
        self.git("add", "source.py", cwd=tree)
        self.git("-c", "commit.gpgsign=false", "commit", "-m", "source", cwd=tree)
        with self.assertRaises(TaskWorkflowError):
            d.candidate(record, "result")
        report = self.report(record)
        report.update(changed_paths=["source.py"], source_commits=[report["head_commit"]])
        self.assertEqual(d.clean_result(record, report), ["source.py"])
        self.assertNotEqual(self.git("rev-parse", "main"), report["head_commit"])

    def test_recovery_maps_exact_resources_without_replaying_native_writes(self):
        record = self.record()
        record.update(intent="prepare-agent", status="workspace_created")
        record.pop("agent_id")
        observation = {"workspaces": [{"id": "workspace", "workspaceDirectory": record["worktree_path"]}], "agents": [{"id": "agent", "workspaceId": "workspace", "cwd": record["worktree_path"], "labels": {"trellis.attempt": record["attempt_id"], "trellis.control": record["control_project_id"]}}]}
        args = argparse.Namespace(workspace_id="workspace", agent_id="agent", delivery_evidence_ref=None, execute=True, reason="native exact mapping verified", approval_ref="existing approval")
        path = d.runtime_path(self.root, self.child.name)
        with patch.object(d, "adapter", return_value=observation) as native:
            adopted = d.recover(self.root, self.child, record, path, args)
            self.assertEqual(adopted["agent_id"], "agent")
            self.assertIsNone(adopted["intent"])
            self.assertEqual(native.call_count, 1)
            self.assertEqual(native.call_args.args[1], "inspect")
        observation["agents"][0]["labels"]["trellis.control"] = "other"
        with patch.object(d, "adapter", return_value=observation), self.assertRaises(TaskWorkflowError):
            d.recover(self.root, self.child, record, path, args)

    def test_unknown_send_needs_controller_delivery_evidence(self):
        record = self.record()
        record["intent"] = "send_pending"
        observation = {"workspaces": [{"id": "workspace", "workspaceDirectory": record["worktree_path"]}], "agents": [{"id": "agent", "workspaceId": "workspace", "cwd": record["worktree_path"], "status": "idle", "labels": {"trellis.attempt": record["attempt_id"], "trellis.control": "control"}}]}
        args = argparse.Namespace(workspace_id=None, agent_id=None, delivery_evidence_ref=None, execute=True, reason="recovery", approval_ref="approved")
        with patch.object(d, "adapter", return_value=observation), self.assertRaises(TaskWorkflowError):
            d.recover(self.root, self.child, record, d.runtime_path(self.root, self.child.name), args)
        self.assertEqual(record["intent"], "send_pending")

    def test_prepare_freezes_absolute_tool_entry_before_daemon_creation(self):
        record = self.record()
        path = d.runtime_path(self.root, self.child.name)
        with patch.object(d.shutil, "which", return_value=None), patch.object(d, "adapter") as native:
            with self.assertRaises(TaskWorkflowError):
                d.prepare_agent(self.root, self.child, record, path)
            native.assert_not_called()
            self.assertNotIn("intent", record)
        with patch.object(d.shutil, "which", return_value=sys.executable), patch.object(d, "adapter", return_value={"agent": {"id": "agent", "workspaceId": "workspace"}}) as native:
            d.prepare_agent(self.root, self.child, record, path)
            payload = native.call_args.args[2]
            self.assertEqual(payload["codegraph_command"], str(Path(sys.executable).resolve()))
            self.assertTrue(payload["codegraph"])
            self.assertIsNone(record["intent"])

    def test_rejected_agent_creation_needs_explicit_absence_evidence(self):
        record = self.record()
        record.update(intent="prepare-agent", status="workspace_created")
        record.pop("agent_id")
        observation = {"workspaces": [{"id": "workspace", "workspaceDirectory": record["worktree_path"]}], "agents": []}
        args = argparse.Namespace(workspace_id=None, agent_id=None, delivery_evidence_ref=None, execute=True, reason="native rejected before creation", approval_ref="approved")
        path = d.runtime_path(self.root, self.child.name)
        with patch.object(d, "adapter", return_value=observation), self.assertRaises(TaskWorkflowError):
            d.recover(self.root, self.child, record, path, args)
        args.delivery_evidence_ref = "native-rejection.md"
        (self.child / args.delivery_evidence_ref).write_text("native existing-workspace visibility validation rejected before agent creation; full background/archived inspection found no attempt agent")
        with patch.object(d, "adapter", return_value=observation) as native:
            adopted = d.recover(self.root, self.child, record, path, args)
            self.assertEqual(adopted["status"], "workspace_created")
            self.assertIsNone(adopted["intent"])
            self.assertNotIn("agent_id", adopted)
            self.assertEqual(native.call_count, 1)
        observation["agents"] = [{"labels": {"trellis.attempt": record["attempt_id"]}}]
        with patch.object(d, "adapter", return_value=observation), self.assertRaises(TaskWorkflowError):
            d.recover(self.root, self.child, record, path, args)

    def test_one_runtime_resolver_preserves_legacy_and_blocks_active_closure(self):
        legacy = {"status": "retired"}
        self.assertEqual(d.resolve_record(self.root, self.child, {"meta": {"delegated_worktree_execution_record": legacy}}), legacy)
        record = self.record()
        path = d.runtime_path(self.root, self.child.name)
        d.save(path, record)
        self.assertEqual(d.resolve_record(self.root, self.child, {}), record)
        with self.assertRaises(TaskWorkflowError):
            _assert_delegated_record_closed("child", record)

    def test_long_wait_releases_controller_locks_and_rechecks_binding(self):
        record = self.record()
        args = argparse.Namespace(child_task=str(self.child), timeout_ms=3600000)
        probe = """
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from common.task_move import layout_lock
from common.task_workflow import _task_lock
with patch('common.task_workflow.get_repo_root', return_value=Path(sys.argv[2])):
    with layout_lock(Path(sys.argv[2])), _task_lock(Path(sys.argv[3])):
        print('controller available')
"""
        def native(*_):
            result = subprocess.check_output([sys.executable, "-c", probe, str(Path(d.__file__).parents[1]), str(self.root), str(self.child)], timeout=3, text=True)
            self.assertEqual(result.strip(), "controller available")
            return {"agent": {"id": "agent", "status": "idle"}}
        with patch.object(d, "get_repo_root", return_value=self.root), patch("common.task_workflow.get_repo_root", return_value=self.root), patch("common.task_workflow._task_dir", return_value=self.child), patch.object(d, "adapter", side_effect=native), contextlib.redirect_stdout(io.StringIO()):
            with patch.object(d, "current", side_effect=[(copy.deepcopy(record), None), (copy.deepcopy(record), None)]):
                self.assertEqual(d.wait_for_node(args), 0)
            changed = copy.deepcopy(record)
            changed["attempt_id"] = "b" * 32
            with patch.object(d, "current", side_effect=[(copy.deepcopy(record), None), (changed, None)]), self.assertRaises(TaskWorkflowError):
                d.wait_for_node(args)


unittest.main()
