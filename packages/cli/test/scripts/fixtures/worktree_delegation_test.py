"""Real Git/filesystem boundaries; native phase authorization is tested separately."""
import argparse
import copy
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
        record.update({"attempt_id": "a" * 32, "workspace_id": "workspace", "agent_id": "agent", "worktree_path": str(tree), "status": "running", "control_project_id": "control", "execution_permission": "preparation"})
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
        observation = {"workspaces": [{"id": "workspace", "workspaceDirectory": record["worktree_path"]}], "agents": [{"id": "agent", "workspaceId": "workspace", "cwd": record["worktree_path"], "labels": {"trellis.attempt": record["attempt_id"], "trellis.control": "control"}}]}
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


unittest.main()
