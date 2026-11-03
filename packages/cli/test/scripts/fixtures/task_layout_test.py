"""Executable relocation regressions using real files and the shipped Python modules."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[3] / "src/templates/trellis/scripts"
sys.path.insert(0, str(SCRIPTS))

from common.task_layout import iter_task_dirs, task_location, task_status_dir
from common.task_move import _plan, apply_plan, journal_path, recover_layout, relocate_task
from common.task_utils import find_task_by_name, resolve_task_dir


class TaskLayoutTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trellis-task-layout-")
        self.root = Path(self.temp.name)
        self.tasks = self.root / ".trellis/tasks"
        self.tasks.mkdir(parents=True)
        shutil.copytree(SCRIPTS, self.root / ".trellis/scripts", ignore=shutil.ignore_patterns("__pycache__"))

    def tearDown(self):
        self.temp.cleanup()

    def task(self, relative, status="planning", **extra):
        directory = self.tasks / relative
        directory.mkdir(parents=True)
        data = {"id": directory.name, "name": directory.name, "status": status, "meta": {}, **extra}
        (directory / "task.json").write_text(json.dumps(data) + "\n", encoding="utf-8")
        return directory

    def run_cli(self, *args):
        return subprocess.run([sys.executable, ".trellis/scripts/task.py", *args], cwd=self.root, capture_output=True, text=True)

    def test_discovery_is_bounded_and_names_span_every_status(self):
        paths = [self.task("planning/01-a"), self.task("in_progress/02-b", "in_progress"),
                 self.task("completed/2026-01/03-c", "completed"), self.task("cancelled/04-d", "cancelled")]
        nested = paths[0] / "research/fake"
        nested.mkdir(parents=True)
        (nested / "task.json").write_text('{"status":"planning"}')
        self.assertEqual(list(iter_task_dirs(self.tasks)), paths)
        self.assertEqual(find_task_by_name("c", self.tasks), paths[2])
        self.assertIsNone(resolve_task_dir(str(nested), self.root))
        self.task("cancelled/01-a", "cancelled")
        self.assertIsNone(find_task_by_name("01-a", self.tasks))

    def test_explicit_phase_initialization_adopts_missing_legacy_metadata_only(self):
        directory = self.task("in_progress/01-legacy", "in_progress", next_action=[{"action": "implement"}])
        path = directory / "task.json"
        original = json.loads(path.read_text())
        del original["meta"]
        path.write_text(json.dumps(original))
        args = ("phase", "init", directory.name, "--task-kind", "combined", "--complexity", "simple",
                "--project-context", "existing", "--phase-ids",
                "goal_exploration_and_requirements,decision_space_construction_and_merging,solution_design_and_convergence,task_implementation,delivery_review_and_closeout")
        self.assertNotEqual(self.run_cli("phase", "show", directory.name).returncode, 0)
        self.assertEqual(json.loads(path.read_text()), original)
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        adopted = json.loads(path.read_text())
        self.assertEqual({k: v for k, v in adopted.items() if k != "meta"}, original)
        self.assertIsNone(adopted["meta"]["task_workflow"]["implementation_authorization"])
        for malformed in (None, [], "invalid"):
            bad = {**original, "meta": malformed}
            path.write_text(json.dumps(bad))
            self.assertNotEqual(self.run_cli(*args).returncode, 0)
            self.assertEqual(json.loads(path.read_text()), bad)

    def test_symlink_and_traversal_are_refused(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.tasks / "planning").mkdir()
        try:
            (self.tasks / "planning/link").symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("symlink creation unavailable")
        self.assertIsNone(task_status_dir(self.tasks / "planning/link", self.tasks))
        self.assertIsNone(resolve_task_dir(str(outside), self.root))
        with self.assertRaises(ValueError):
            list(iter_task_dirs(self.tasks))
        with self.assertRaises(ValueError):
            task_location(self.tasks, "../outside", "cancelled")

    def test_migration_preserves_month_content_and_updates_current_references(self):
        old = self.task("archive/2026-01/01-old", "completed", completedAt="2026-02-03")
        active = self.task("02-current", "in_progress", children=["01-old"])
        content = b"\x00\xfforiginal task data\n"
        (old / "payload.bin").write_bytes(content)
        context = {"file": ".trellis/tasks/02-current/prd.md", "reason": "current task"}
        (active / "implement.jsonl").write_text(json.dumps(context) + "\n")
        session = self.root / ".trellis/.runtime/sessions/test.json"
        session.parent.mkdir(parents=True)
        session.write_text(json.dumps({"current_task": ".trellis/tasks/02-current", "other": "kept"}))
        before = {p.relative_to(self.tasks).as_posix(): p.read_bytes() for p in self.tasks.rglob("*") if p.is_file()}
        preview = self.run_cli("migrate-layout")
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertEqual(before, {p.relative_to(self.tasks).as_posix(): p.read_bytes() for p in self.tasks.rglob("*") if p.is_file()})
        applied = self.run_cli("migrate-layout", "--apply")
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual((self.tasks / "completed/2026-01/01-old/payload.bin").read_bytes(), content)
        self.assertEqual(json.loads((self.tasks / "in_progress/02-current/task.json").read_text())["children"], ["01-old"])
        self.assertEqual(json.loads(session.read_text())["current_task"], ".trellis/tasks/in_progress/02-current")
        self.assertEqual(json.loads((self.tasks / "in_progress/02-current/implement.jsonl").read_text())["file"], ".trellis/tasks/in_progress/02-current/prd.md")
        self.assertFalse((self.tasks / "archive").exists())
        self.assertEqual(json.loads(self.run_cli("migrate-layout").stdout)["moves"], {})
        self.assertFalse(journal_path(self.root).exists())

    def test_invalid_json_and_conflicts_leave_sources_intact(self):
        first = self.task("01-a")
        second = self.task("02-b")
        (second / "task.json").write_text('{"status": planning}')
        result = self.run_cli("migrate-layout", "--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(first.exists())
        self.assertFalse((self.tasks / "planning/01-a").exists())
        (second / "task.json").write_text('{"status":"planning"}')
        self.task("planning/01-a")
        result = self.run_cli("migrate-layout", "--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(first.exists())

    def test_status_move_keeps_identity_phase_and_relationships(self):
        directory = self.task("in_progress/01-a", "in_progress", parent="00-parent", children=["02-child"],
                              meta={"task_workflow": {"task_route_revision": "7", "implementation_authorization": {"approval_ref": "user:approved"}}})
        data = json.loads((directory / "task.json").read_text())
        data["status"] = "completed"
        destination = relocate_task(self.root, directory, data)
        self.assertEqual(destination.parent.parent.name, "completed")
        self.assertEqual(json.loads((destination / "task.json").read_text()), data)
        self.assertFalse(directory.exists())

    def test_failure_rolls_back_every_move_and_file(self):
        first, second = self.task("01-a"), self.task("02-b")
        original = (first / "task.json").read_bytes()
        moves = [(first, self.tasks / "planning/01-a"), (second, self.tasks / "planning/02-b")]
        plan = _plan(self.root, moves, {first: {"id": "01-a", "status": "planning", "meta": {"sentinel": "new"}}})
        rename = Path.rename

        def fail_second(path, target):
            if path == second:
                raise OSError("simulated disk failure")
            return rename(path, target)

        with mock.patch.object(Path, "rename", fail_second):
            with self.assertRaises(OSError):
                apply_plan(self.root, plan)
        self.assertEqual((first / "task.json").read_bytes(), original)
        self.assertTrue(second.exists())
        self.assertFalse(journal_path(self.root).exists())

    def test_crash_requires_explicit_recovery_before_commands(self):
        directory = self.task("01-a")
        target = self.tasks / "planning/01-a"
        plan = _plan(self.root, [(directory, target)], {})
        journal_path(self.root).parent.mkdir(parents=True)
        journal_path(self.root).write_text(json.dumps(plan))
        target.parent.mkdir(parents=True)
        directory.rename(target)
        result = self.run_cli("list")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires recovery", result.stderr)
        recover_layout(self.root)
        self.assertTrue(directory.exists())
        self.assertFalse(target.exists())

    def test_pending_transfer_is_fenced(self):
        directory = self.task("planning/01-a")
        relative = directory.relative_to(self.root).as_posix()
        owner = self.root / ".trellis/.runtime/task-ownership" / (hashlib.sha256(relative.encode()).hexdigest() + ".json")
        owner.parent.mkdir(parents=True)
        owner.write_text(json.dumps({"schema_version": 1, "task_id": "01-a", "task_path": relative,
            "package_id": "test", "package_digest": "a" * 64, "generation": 1, "status": "ready",
            "source_session_id": "source", "target_session_id": None, "continuity_digest": "b" * 64, "route": {}}))
        data = json.loads((directory / "task.json").read_text())
        data["status"] = "in_progress"
        with self.assertRaisesRegex(ValueError, "ownership prevents"):
            relocate_task(self.root, directory, data)
        self.assertTrue(directory.exists())

    def test_consumed_transfer_rekeys_current_paths_without_regranting_history(self):
        directory = self.task("01-a", "in_progress")
        relative = directory.relative_to(self.root).as_posix()
        destination = self.tasks / "in_progress/01-a"
        new_relative = destination.relative_to(self.root).as_posix()
        owners = self.root / ".trellis/.runtime/task-ownership"
        owners.mkdir(parents=True)
        old_owner = owners / (hashlib.sha256(relative.encode()).hexdigest() + ".json")
        record = {"schema_version": 1, "task_id": "01-a", "task_path": relative,
                  "package_id": "history", "package_digest": "a" * 64, "generation": 4,
                  "status": "consumed", "source_session_id": "source", "target_session_id": "target",
                  "continuity_digest": "b" * 64, "target_continuity_digest": "c" * 64, "route": {}}
        old_owner.write_text(json.dumps(record))
        active = SimpleNamespace(context_key="target", task_path=relative)
        with mock.patch("common.active_task.resolve_active_task", return_value=active):
            apply_plan(self.root, _plan(self.root, [(directory, destination)], {}))
        self.assertFalse(old_owner.exists())
        new_owner = owners / (hashlib.sha256(new_relative.encode()).hexdigest() + ".json")
        self.assertEqual(json.loads(new_owner.read_text()), {**record, "task_path": new_relative})
        self.assertTrue(destination.exists())

    def test_recovery_checks_all_inputs_before_moving_or_overwriting(self):
        directory = self.task("01-a")
        target = self.tasks / "planning/01-a"
        plan = _plan(self.root, [(directory, target)], {directory: {"id": "01-a", "status": "planning"}})
        journal_path(self.root).parent.mkdir(parents=True)
        journal_path(self.root).write_text(json.dumps(plan))
        target.parent.mkdir(parents=True)
        directory.rename(target)
        (target / "task.json").write_text('{"external":"edit"}')
        with self.assertRaisesRegex(ValueError, "Recovery input changed"):
            recover_layout(self.root)
        self.assertTrue(target.exists())
        self.assertFalse(directory.exists())
        self.assertTrue(journal_path(self.root).exists())
        self.assertEqual((target / "task.json").read_text(), '{"external":"edit"}')

    def test_recovery_rejects_non_transaction_files_and_invalid_values(self):
        directory = self.task("01-a")
        plan = _plan(self.root, [(directory, self.tasks / "planning/01-a")], {})
        journal_path(self.root).parent.mkdir(parents=True)
        for relative, value in [(".trellis/tasks/01-a/prd.md", "overwrite"),
                                (".trellis/tasks/01-a/task.json", {"invalid": "text"}),
                                (".trellis/.runtime/unrelated.json", "overwrite")]:
            plan["before"] = {relative: value}
            plan["after"] = {relative: None}
            journal_path(self.root).write_text(json.dumps(plan))
            with self.assertRaises(ValueError):
                recover_layout(self.root)
            self.assertTrue(directory.exists())

    def test_terminal_transition_removes_pointers_in_the_same_transaction(self):
        directory = self.task("in_progress/01-a", "in_progress")
        relative = directory.relative_to(self.root).as_posix()
        session = self.root / ".trellis/.runtime/sessions/test.json"
        session.parent.mkdir(parents=True)
        session.write_text(json.dumps({"current_task": relative}))
        continuity = self.root / ".trellis/.runtime/continuity" / (hashlib.sha256(relative.encode()).hexdigest() + ".json")
        continuity.parent.mkdir(parents=True)
        continuity.write_text(json.dumps({"task_path": relative}))
        data = json.loads((directory / "task.json").read_text())
        data["status"] = "cancelled"
        plan = _plan(self.root, [(directory, self.tasks / "cancelled/01-a")], {directory: data})
        with mock.patch.object(Path, "rename", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                apply_plan(self.root, plan)
        self.assertTrue(session.exists())
        self.assertTrue(continuity.exists())
        relocate_task(self.root, directory, data)
        self.assertFalse(session.exists())
        self.assertFalse(continuity.exists())


if __name__ == "__main__":
    unittest.main()
