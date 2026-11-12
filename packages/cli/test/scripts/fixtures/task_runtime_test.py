"""Runtime regressions through the real shipped helpers and filesystem."""

from __future__ import annotations

import json
import argparse
import contextlib
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[3] / "src/templates/trellis/scripts"
sys.path.insert(0, str(SCRIPTS))

from common import active_task, session_context, task_runtime, task_workflow, worktree_delegation
from common.task_move import layout_lock


class TaskRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trellis-task-runtime-")
        self.root = Path(self.temp.name)
        self.tasks = self.root / ".trellis/tasks"
        self.tasks.mkdir(parents=True)
        self.a = self.task("planning/01-a", "planning")
        self.b = self.task("planning/02-b", "planning")
        self.c = self.task("planning/03-c", "planning")

    def tearDown(self):
        self.temp.cleanup()

    def task(self, relative, status, **extra):
        directory = self.tasks / relative
        directory.mkdir(parents=True)
        data = {"id": directory.name, "name": directory.name, "title": directory.name,
                "status": status, "meta": {}, "assignee": "tester", **extra}
        (directory / "task.json").write_text(json.dumps(data), encoding="utf-8")
        return directory.relative_to(self.root).as_posix()

    def pointer(self, **extra):
        path = self.root / ".trellis/.runtime/sessions/test-session.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"current_task": self.a, "current_run": None, **extra}), encoding="utf-8")
        return path

    def test_empty_projection_exits_but_unknown_fields_and_runs_survive(self):
        path = self.pointer(platform="codex", last_seen_at="2026-11-12")
        self.assertTrue(active_task.clear_active_task_if_matches(self.root, "test-session", self.a))
        self.assertFalse(path.exists())
        path = self.pointer(recovery={"pending": True})
        self.assertTrue(active_task.clear_active_task_if_matches(self.root, "test-session", self.a))
        self.assertEqual(json.loads(path.read_text()), {"current_run": None, "recovery": {"pending": True}})
        path = self.pointer(current_run={"id": "live-run"})
        self.assertEqual(active_task.clear_task_from_sessions(self.a, self.root), 1)
        self.assertEqual(json.loads(path.read_text()), {"current_run": {"id": "live-run"}})
        for data in ({"current_task": False}, {"current_task": None, "platform": {"unrecognized": True}}):
            with self.subTest(data=data):
                self.assertTrue(active_task._write_json(path, data))
                self.assertEqual(json.loads(path.read_text()), data)

    def test_wrong_expected_pointer_and_failed_write_preserve_original(self):
        path = self.pointer(recovery="retain")
        original = path.read_bytes()
        self.assertFalse(active_task.compare_and_set_active_task(self.root, "test-session", self.b, self.c))
        with mock.patch("common.io.os.replace", side_effect=OSError("injected failure")):
            self.assertFalse(active_task.compare_and_set_active_task(self.root, "test-session", self.a, self.b))
        self.assertEqual(path.read_bytes(), original)

    def test_query_and_direct_helpers_reuse_one_fixed_anchor(self):
        self.pointer()
        with mock.patch.object(task_workflow, "get_repo_root", return_value=self.root):
            with layout_lock(self.root), task_workflow._task_lock(self.root / self.a):
                self.assertTrue(active_task.compare_and_set_active_task(self.root, "test-session", self.a, self.b))
        runtime = self.root / ".trellis/.runtime"
        self.assertEqual([p.relative_to(runtime).as_posix() for p in runtime.rglob("*.lock")], ["task-layout.lock"])
        anchor = runtime / "task-layout.lock"
        inode = anchor.stat().st_ino
        with layout_lock(self.root):
            pass
        self.assertEqual(anchor.stat().st_ino, inode)

    def test_two_processes_cannot_both_win_pointer_cas(self):
        self.pointer()
        gate = self.root / "gate"
        code = """
import json,sys,time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from common.active_task import compare_and_set_active_task
root=Path(sys.argv[2])
for _ in range(500):
    if (root/'gate').exists(): break
    time.sleep(0.01)
else: raise SystemExit('gate timeout')
print(json.dumps(compare_and_set_active_task(root,'test-session',sys.argv[3],sys.argv[4])))
"""
        children = [subprocess.Popen([sys.executable, "-c", code, str(SCRIPTS), str(self.root), self.a, target],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    for target in (self.b, self.c)]
        try:
            gate.write_text("go")
            results = [child.communicate(timeout=15) for child in children]
            self.assertEqual([child.returncode for child in children], [0, 0], results)
            self.assertEqual(sorted(json.loads(out) for out, _ in results), [False, True])
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.communicate()

    def test_active_views_filter_terminals_without_losing_child_progress(self):
        done = self.task("completed/2026-11/04-done", "completed")
        self.task("cancelled/05-cancelled", "cancelled")
        a_path = self.root / self.a / "task.json"
        data = json.loads(a_path.read_text())
        data["children"] = [Path(done).name]
        a_path.write_text(json.dumps(data))
        with mock.patch.object(session_context, "get_developer", return_value="tester"):
            view = session_context.get_context_json(self.root)
            self.assertEqual({t["dir"] for t in view["tasks"]["active"]}, {"01-a", "02-b", "03-c"})
            text = session_context.get_context_text(self.root)
            active = text.split("## ACTIVE TASKS", 1)[1].split("## MY TASKS", 1)[0]
            self.assertNotIn("04-done", active)
            self.assertNotIn("05-cancelled", active)
            self.assertIn("1/1", active)

    def test_update_hint_is_bounded_and_detects_version_pair_changes(self):
        (self.root / ".trellis/.version").write_text("0.7.1")
        with mock.patch.object(session_context, "_resolve_available_update_version", return_value="0.7.2"):
            self.assertIsNotNone(session_context.get_update_hint(self.root, "one"))
            self.assertIsNone(session_context.get_update_hint(self.root, "two"))
        with mock.patch.object(session_context, "_resolve_available_update_version", return_value="0.7.3"):
            self.assertIsNotNone(session_context.get_update_hint(self.root, "three"))
        runtime = self.root / ".trellis/.runtime"
        self.assertEqual([p.name for p in runtime.glob("update-check*")], ["update-check.json"])

    def test_runtime_preview_is_bounded_owner_scoped_and_rechecks_confirmation(self):
        scripts = self.root / ".trellis/scripts"
        (scripts / "common").mkdir(parents=True)
        for name in ["task.py", "common/active_task.py", "common/task_workflow.py", "common/task_continuity.py"]:
            shutil.copyfile(SCRIPTS / name, scripts / name)
        runtime = self.root / ".trellis/.runtime"
        empty = self.pointer()
        empty.write_text(json.dumps({"current_run": None, "platform": "codex"}))
        bad = empty.with_name("bad.json")
        bad.write_text("{bad")
        unknown = empty.with_name("unknown.json")
        unknown.write_text(json.dumps({"recovery": "retain"}))
        marker = runtime / "update-check-codex_old.marker"
        marker.write_bytes(b"checked\n")
        fixed = runtime / "task-layout.lock"
        fixed.touch()
        legacy = runtime / "task-phase/01-01-a.lock"
        legacy.parent.mkdir()
        legacy.touch()
        evidence = runtime / "handoff-lifecycle/evidence.jsonl"
        evidence.parent.mkdir()
        evidence.write_text("durable")
        current = task_runtime.preview(self.root)
        anchor = next(i for i in current["items"] if i["path"].endswith("01-01-a.lock"))
        expected = [empty, marker] + ([legacy] if anchor["eligible"] else [])
        self.assertEqual({i["path"] for i in current["items"] if i["eligible"]},
                         {p.relative_to(self.root).as_posix() for p in expected})
        if not anchor["eligible"]:
            self.assertIn("descriptor", anchor["reason"])
        with legacy.open("rb"):
            held = task_runtime.preview(self.root)
        self.assertFalse(next(i for i in held["items"] if i["path"].endswith("01-01-a.lock"))["eligible"])
        marker.write_bytes(b"different")
        with mock.patch.object(task_runtime, "get_repo_root", return_value=self.root), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(task_runtime.cmd_runtime(argparse.Namespace(dir=None, confirm=current["digest"])), 1)
            self.assertTrue(empty.exists())
            fresh = task_runtime.preview(self.root)
            self.assertEqual(task_runtime.cmd_runtime(argparse.Namespace(dir=None, confirm=fresh["digest"])), 0)
        for kept in [fixed, marker, bad, unknown, evidence]:
            self.assertTrue(kept.exists(), kept)
        self.assertFalse(empty.exists())
        self.assertEqual(legacy.exists(), not anchor["eligible"])

    def test_runtime_cli_defaults_to_preview_and_requires_a_fresh_digest(self):
        marker = self.root / ".trellis/.runtime/update-check-codex_old.marker"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_bytes(b"checked\n")
        command = [sys.executable, str(SCRIPTS / "task.py"), "runtime"]
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        preview = json.loads(result.stdout)
        self.assertTrue(preview["dry_run"])
        self.assertTrue(marker.exists())
        marker.write_bytes(b"changed\n")
        stale = subprocess.run(command + ["--confirm", preview["digest"]], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(stale.returncode, 1, stale.stderr)
        self.assertTrue(marker.exists())

    def test_terminal_delegation_inspect_is_read_only_and_does_not_call_provider(self):
        path = self.root / self.a / "task.json"
        record = json.loads(path.read_text())
        record.update(status="completed", meta={"delegated_worktree_execution_record": {"status": "retired", "historical": "retain"}})
        path.write_text(json.dumps(record))
        original = path.read_bytes()
        with mock.patch.object(worktree_delegation, "get_repo_root", return_value=self.root), mock.patch.object(task_workflow, "get_repo_root", return_value=self.root), mock.patch.object(task_workflow, "_task_dir", return_value=path.parent), mock.patch.object(worktree_delegation, "adapter") as provider, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(worktree_delegation.run(argparse.Namespace(command="delegate-inspect", child_task=str(path.parent))), 0)
            provider.assert_not_called()
        self.assertTrue(json.loads(output.getvalue())["historical"])
        self.assertEqual(path.read_bytes(), original)
        with mock.patch.object(worktree_delegation, "get_repo_root", return_value=self.root), self.assertRaises(task_workflow.TaskWorkflowError):
            worktree_delegation.task_inputs(path.parent)


if __name__ == "__main__":
    unittest.main()
