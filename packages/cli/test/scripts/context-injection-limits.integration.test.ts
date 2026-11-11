/**
 * Integration tests for sub-agent context injection limits (issue #441).
 *
 * Covers two templates:
 *   - `src/templates/trellis/scripts/common/config.py` — config parsing
 *     (`get_context_injection_limits`)
 *   - `src/templates/shared-hooks/inject-subagent-context.py` — truncation,
 *     total-budget degradation, UTF-8 safety
 *   - `src/templates/trellis/scripts/common/task_context.py` — `task.py
 *     validate` path resolution and hygiene warnings
 *
 * Scripts are stamped into a fresh temp dir and exercised through the real
 * `python3` interpreter (no mocking of file I/O or config parsing).
 */

/**
 * Integration tests for sub-agent context injection limits (issue #441).
 *
 * Covers two templates:
 *   - `src/templates/trellis/scripts/common/config.py` — config parsing
 *     (`get_context_injection_limits`)
 *   - `src/templates/shared-hooks/inject-subagent-context.py` — truncation,
 *     total-budget degradation, UTF-8 safety
 *   - `src/templates/trellis/scripts/common/task_context.py` — `task.py
 *     validate` path resolution and hygiene warnings
 *
 * Scripts are stamped into a fresh temp dir and exercised through the real
 * `python3` interpreter (no mocking of file I/O or config parsing).
 */
/**
 * Integration tests for sub-agent context injection limits (issue #441).
 *
 * Covers two templates:
 *   - `src/templates/trellis/scripts/common/config.py` — config parsing
 *     (`get_context_injection_limits`)
 *   - `src/templates/shared-hooks/inject-subagent-context.py` — truncation,
 *     total-budget degradation, UTF-8 safety
 *   - `src/templates/trellis/scripts/common/task_context.py` — `task.py
 *     validate` path resolution and hygiene warnings
 *
 * Scripts are stamped into a fresh temp dir and exercised through the real
 * `python3` interpreter (no mocking of file I/O or config parsing).
 */
/**
 * Integration tests for sub-agent context injection limits (issue #441).
 *
 * Covers two templates:
 *   - `src/templates/trellis/scripts/common/config.py` — config parsing
 *     (`get_context_injection_limits`)
 *   - `src/templates/shared-hooks/inject-subagent-context.py` — truncation,
 *     total-budget degradation, UTF-8 safety
 *   - `src/templates/trellis/scripts/common/task_context.py` — `task.py
 *     validate` path resolution and hygiene warnings
 *
 * Scripts are stamped into a fresh temp dir and exercised through the real
 * `python3` interpreter (no mocking of file I/O or config parsing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const TASK_CONTEXT_PATH = path.join(
  TEMPLATE_SCRIPTS,
  "common",
  "task_context.py",
);

describe("task_context.py Python compatibility", () => {
  it("avoids the nested multiline f-strings rejected by Python 3.9-3.11 (#476)", () => {
    const source = fs.readFileSync(TASK_CONTEXT_PATH, "utf-8");
    expect(
      source.match(/f"[ ]{2}\{colored\(f'[^'\n]*'\s*\n\s*f?'/g) ?? [],
    ).toHaveLength(0);
  });
});

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
}

function writeConfig(tmp: string, yaml: string): void {
  fs.writeFileSync(path.join(tmp, ".trellis", "config.yaml"), yaml, "utf-8");
}

function runConfigProbe(tmp: string, code: string): string {
  const probePath = path.join(tmp, "config_probe.py");
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(path.join(tmp, ".trellis", "scripts"))})
from pathlib import Path
from common.config import get_context_injection_limits
REPO_ROOT = Path(${JSON.stringify(tmp)})
${code}
`;
  fs.writeFileSync(probePath, script, "utf-8");
  const r = spawnSync("python3", [probePath], {
    cwd: tmp,
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    throw new Error(`probe failed (rc=${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

function makeTask(tmp: string, dirName: string): string {
  const taskDir = path.join(tmp, ".trellis", "tasks", "in_progress", dirName);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({ id: dirName, title: dirName, status: "in_progress" }) +
      "\n",
    "utf-8",
  );
  return taskDir;
}

function makeArchivedTask(tmp: string, dirName: string): string {
  const activeTaskDir = makeTask(tmp, dirName);
  const archivedTaskDir = path.join(
    tmp,
    ".trellis",
    "tasks",
    "completed",
    "2026-08",
    dirName,
  );
  fs.mkdirSync(path.dirname(archivedTaskDir), { recursive: true });
  fs.renameSync(activeTaskDir, archivedTaskDir);
  return archivedTaskDir;
}

function runTaskValidate(
  tmp: string,
  taskDir: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "python3",
    [path.join(tmp, ".trellis", "scripts", "task.py"), "validate", taskDir],
    { cwd: tmp, encoding: "utf-8" },
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!hasPython())("context injection limits (issue #441)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-context-limits-test-"),
    );
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("common/config.py: get_context_injection_limits", () => {
    it("returns built-in defaults when config.yaml has no context_injection section", () => {
      writeConfig(tmp, "session_auto_commit: true\n");
      const out = runConfigProbe(
        tmp,
        "print(get_context_injection_limits(REPO_ROOT))",
      );
      expect(out.trim()).toBe(
        "{'max_file_bytes': 32768, 'max_artifact_bytes': 65536, 'max_total_bytes': 131072}",
      );
    });

    it("returns built-in defaults when config.yaml is absent", () => {
      const out = runConfigProbe(
        tmp,
        "print(get_context_injection_limits(REPO_ROOT))",
      );
      expect(out.trim()).toBe(
        "{'max_file_bytes': 32768, 'max_artifact_bytes': 65536, 'max_total_bytes': 131072}",
      );
    });

    it("applies explicit overrides for all three keys", () => {
      writeConfig(
        tmp,
        [
          "context_injection:",
          "  max_file_bytes: 100",
          "  max_artifact_bytes: 200",
          "  max_total_bytes: 300",
        ].join("\n"),
      );
      const out = runConfigProbe(
        tmp,
        "print(get_context_injection_limits(REPO_ROOT))",
      );
      expect(out.trim()).toBe(
        "{'max_file_bytes': 100, 'max_artifact_bytes': 200, 'max_total_bytes': 300}",
      );
    });

    it("0 means unlimited and is preserved as-is (not replaced by default)", () => {
      writeConfig(
        tmp,
        ["context_injection:", "  max_total_bytes: 0"].join("\n"),
      );
      const out = runConfigProbe(
        tmp,
        "print(get_context_injection_limits(REPO_ROOT)['max_total_bytes'])",
      );
      expect(out.trim()).toBe("0");
    });

    it("falls back to default and warns on stderr for a negative value", () => {
      writeConfig(
        tmp,
        ["context_injection:", "  max_file_bytes: -5"].join("\n"),
      );
      const probePath = path.join(tmp, "probe_neg.py");
      fs.writeFileSync(
        probePath,
        `
import sys
sys.path.insert(0, ${JSON.stringify(path.join(tmp, ".trellis", "scripts"))})
from pathlib import Path
from common.config import get_context_injection_limits
print(get_context_injection_limits(Path(${JSON.stringify(tmp)}))["max_file_bytes"])
`,
        "utf-8",
      );
      const r = spawnSync("python3", [probePath], {
        cwd: tmp,
        encoding: "utf-8",
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("32768");
      expect(r.stderr).toContain("invalid context_injection.max_file_bytes");
    });

    it("falls back to default and warns on stderr for a non-integer value", () => {
      writeConfig(
        tmp,
        ["context_injection:", "  max_artifact_bytes: not-a-number"].join("\n"),
      );
      const probePath = path.join(tmp, "probe_nan.py");
      fs.writeFileSync(
        probePath,
        `
import sys
sys.path.insert(0, ${JSON.stringify(path.join(tmp, ".trellis", "scripts"))})
from pathlib import Path
from common.config import get_context_injection_limits
print(get_context_injection_limits(Path(${JSON.stringify(tmp)}))["max_artifact_bytes"])
`,
        "utf-8",
      );
      const r = spawnSync("python3", [probePath], {
        cwd: tmp,
        encoding: "utf-8",
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("65536");
      expect(r.stderr).toContain(
        "invalid context_injection.max_artifact_bytes",
      );
    });
  });

  describe("task.py validate: JSONL hygiene warnings", () => {
    it("warns (does not error) on a jsonl entry that looks like a code file", () => {
      const taskDir = makeTask(tmp, "task-code-warn");
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src", "index.ts"),
        "export const x = 1;\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: "src/index.ts", reason: "wrong" }) + "\n",
        "utf-8",
      );
      const { status, stdout } = runTaskValidate(tmp, taskDir);
      expect(status).toBe(0);
      expect(stdout).toContain(
        "implement.jsonl:1: Warning: src/index.ts looks like a code file — " +
          "implement/check.jsonl should reference spec/research docs; " +
          "agents read code themselves",
      );
      expect(stdout).toContain("All validations passed");
    });

    it("does not warn about a code-looking path under .trellis/spec/, docs/, or the task's own directory", () => {
      const taskDir = makeTask(tmp, "task-code-exempt");
      fs.mkdirSync(path.join(tmp, ".trellis", "spec"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".trellis", "spec", "example.py"),
        "# example only\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({
          file: ".trellis/spec/example.py",
          reason: "spec code sample",
        }) + "\n",
        "utf-8",
      );
      const { status, stdout } = runTaskValidate(tmp, taskDir);
      expect(status).toBe(0);
      expect(stdout).not.toContain("looks like a code file");
    });

    it("warns on a jsonl entry whose file size exceeds max_file_bytes", () => {
      const taskDir = makeTask(tmp, "task-size-warn");
      fs.writeFileSync(
        path.join(tmp, "oversized.md"),
        "X".repeat(200),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: "oversized.md", reason: "big" }) + "\n",
        "utf-8",
      );
      writeConfig(
        tmp,
        ["context_injection:", "  max_file_bytes: 100"].join("\n"),
      );
      const { status, stdout } = runTaskValidate(tmp, taskDir);
      expect(status).toBe(0);
      expect(stdout).toContain(
        "implement.jsonl:1: Warning: oversized.md is 200 bytes, " +
          "exceeds context_injection.max_file_bytes (100); " +
          "injection will truncate it",
      );
    });

    it("survives a file that disappears between is_file() and stat()", () => {
      // The size check is advisory, so it must never be what fails
      // `validate`. Its `stat()` sits after an `is_file()` check, and the
      // gap between them is a real window: the file can be removed, or the
      // directory can lose traversal permission, in between.
      //
      // The race cannot be won from outside the process, so it is staged
      // in-process: `is_file()` is forced True for a path that is really
      // gone, which is exactly the state the loser of that race observes.
      const taskDir = makeTask(tmp, "task-size-race");
      fs.writeFileSync(path.join(tmp, "present.md"), "X".repeat(200), "utf-8");
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: "present.md", reason: "big" }) +
          "\n" +
          JSON.stringify({ file: "vanished.md", reason: "raced" }) +
          "\n",
        "utf-8",
      );
      writeConfig(
        tmp,
        ["context_injection:", "  max_file_bytes: 100"].join("\n"),
      );

      const harness = [
        "import sys",
        "from pathlib import Path",
        `sys.path.insert(0, ${JSON.stringify(
          path.join(tmp, ".trellis", "scripts"),
        )})`,
        "from common import task_context",
        "_real = Path.is_file",
        "Path.is_file = lambda self: True if self.name == 'vanished.md' else _real(self)",
        `task_dir = Path(${JSON.stringify(taskDir)})`,
        `repo = Path(${JSON.stringify(tmp)})`,
        "errors = task_context._validate_jsonl(task_dir / 'implement.jsonl', repo, task_dir)",
        "print('ERRORS=%d' % errors)",
      ].join("\n");

      const r = spawnSync("python3", ["-c", harness], {
        cwd: tmp,
        encoding: "utf-8",
      });

      // No traceback, and the advisory check contributed no errors.
      expect(r.stderr).not.toContain("Traceback");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("ERRORS=0");
      // The readable file is still measured and still warned about.
      expect(r.stdout).toContain(
        "implement.jsonl:1: Warning: present.md is 200 bytes, " +
          "exceeds context_injection.max_file_bytes (100); " +
          "injection will truncate it",
      );
      // The vanished one produces no size warning at all.
      expect(r.stdout).not.toContain("vanished.md is");
    });

    it("stays warning-free for a clean, under-cap, spec-only manifest", () => {
      const taskDir = makeTask(tmp, "task-clean");
      fs.mkdirSync(path.join(tmp, ".trellis", "spec"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".trellis", "spec", "guide.md"),
        "spec guide\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({
          file: ".trellis/spec/guide.md",
          reason: "guide",
        }) + "\n",
        "utf-8",
      );
      const { status, stdout } = runTaskValidate(tmp, taskDir);
      expect(status).toBe(0);
      expect(stdout).not.toContain("Warning:");
      expect(stdout).toContain("All validations passed");
    });
  });

  describe("task.py validate: completed task paths (#518)", () => {
    const taskName = "08-04-archive-validator-repro";
    const historicalEvidence = `.trellis/tasks/completed/2026-08/${taskName}/research/evidence.md`;

    it("#1 validates a completed task using its explicit path without rewriting", () => {
      const taskDir = makeArchivedTask(tmp, taskName);
      fs.mkdirSync(path.join(taskDir, "research"), { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "research", "evidence.md"),
        "archived evidence\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "docs", "reference.md"),
        "repository documentation\n",
        "utf-8",
      );
      const manifestPath = path.join(taskDir, "implement.jsonl");
      const manifest =
        [
          JSON.stringify({ file: historicalEvidence, reason: "evidence" }),
          JSON.stringify({
            file: "docs/reference.md",
            reason: "repository documentation",
          }),
        ].join("\n") + "\n";
      fs.writeFileSync(manifestPath, manifest, "utf-8");

      const taskDirWithParentSegment = taskDir;
      const { status, stdout } = runTaskValidate(tmp, taskDirWithParentSegment);

      expect(status).toBe(0);
      expect(stdout).toContain("implement.jsonl: ✓ (2 entries)");
      expect(stdout).toContain("All validations passed");
      expect(fs.readFileSync(manifestPath, "utf-8")).toBe(manifest);
    });

    it("#2 validates an archived task self-directory", () => {
      const taskDir = makeArchivedTask(tmp, taskName);
      fs.mkdirSync(path.join(taskDir, "research"), { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({
          file: `.trellis/tasks/completed/2026-08/${taskName}/research/`,
          type: "directory",
          reason: "research directory",
        }) + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, taskDir);

      expect(status).toBe(0);
      expect(stdout).toContain("All validations passed");
    });

    it("#3 keeps an unrelated missing task reference as an error", () => {
      const taskDir = makeArchivedTask(tmp, taskName);
      const missingPath = ".trellis/tasks/another-task/research/missing.md";
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: missingPath, reason: "other task" }) + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, taskDir);

      expect(status).toBe(1);
      expect(stdout).toContain(`File not found: ${missingPath}`);
    });

    it("#4 does not fall back to a recreated active task when the archive copy is missing", () => {
      const taskDir = makeArchivedTask(tmp, taskName);
      const activeTaskDir = makeTask(tmp, taskName);
      fs.mkdirSync(path.join(activeTaskDir, "research"), { recursive: true });
      fs.writeFileSync(
        path.join(activeTaskDir, "research", "evidence.md"),
        "active evidence only\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: historicalEvidence, reason: "evidence" }) + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, taskDir);

      expect(status).toBe(1);
      expect(stdout).toContain(`File not found: ${historicalEvidence}`);
    });

    it("#5 rejects traversal in an archived self-reference without active-task fallback", () => {
      const taskDir = makeArchivedTask(tmp, taskName);
      const activeTaskDir = makeTask(tmp, taskName);
      fs.mkdirSync(path.join(activeTaskDir, "research"), { recursive: true });
      fs.writeFileSync(
        path.join(activeTaskDir, "research", "active-only.md"),
        "active evidence only\n",
        "utf-8",
      );
      const traversalPath = `.trellis/tasks/${taskName}/../${taskName}/research/active-only.md`;
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        JSON.stringify({ file: traversalPath, reason: "traversal" }) + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, taskDir);

      expect(status).toBe(1);
      expect(stdout).toContain(`File not found: ${traversalPath}`);
    });

    it.skipIf(process.platform === "win32")(
      "#6 rejects a symlink that escapes the archived task",
      () => {
        const taskDir = makeArchivedTask(tmp, taskName);
        const activeTaskDir = makeTask(tmp, taskName);
        const activeEvidence = path.join(
          activeTaskDir,
          "research",
          "evidence.md",
        );
        fs.mkdirSync(path.dirname(activeEvidence), { recursive: true });
        fs.writeFileSync(activeEvidence, "active evidence only\n", "utf-8");
        const archivedEvidence = path.join(taskDir, "research", "evidence.md");
        fs.mkdirSync(path.dirname(archivedEvidence), { recursive: true });
        fs.symlinkSync(activeEvidence, archivedEvidence);
        fs.writeFileSync(
          path.join(taskDir, "implement.jsonl"),
          JSON.stringify({ file: historicalEvidence, reason: "evidence" }) +
            "\n",
          "utf-8",
        );

        const { status, stdout } = runTaskValidate(tmp, taskDir);

        expect(status).toBe(1);
        expect(stdout).toContain(`File not found: ${historicalEvidence}`);
      },
    );

    it("#7 leaves active-task and unrelated repository path validation unchanged", () => {
      const taskDir = makeTask(tmp, taskName);
      fs.mkdirSync(path.join(taskDir, "research"), { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "research", "evidence.md"),
        "active evidence\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "docs", "reference.md"),
        "repository documentation\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        [
          JSON.stringify({
            file: `.trellis/tasks/in_progress/${taskName}/research/evidence.md`,
            reason: "evidence",
          }),
          JSON.stringify({
            file: "docs/reference.md",
            reason: "repository documentation",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, taskDir);

      expect(status).toBe(0);
      expect(stdout).toContain("implement.jsonl: ✓ (2 entries)");
      expect(stdout).toContain("All validations passed");
    });

    it("#8 rejects a malformed completion month without falling back to another task", () => {
      const archivedTaskDir = makeArchivedTask(tmp, taskName);
      const malformedArchiveTaskDir = path.join(
        tmp,
        ".trellis",
        "tasks",
        "completed",
        "2026-8",
        taskName,
      );
      fs.mkdirSync(path.dirname(malformedArchiveTaskDir), {
        recursive: true,
      });
      fs.renameSync(archivedTaskDir, malformedArchiveTaskDir);

      const activeTaskDir = makeTask(tmp, taskName);
      const activeEvidence = path.join(
        activeTaskDir,
        "research",
        "evidence.md",
      );
      fs.mkdirSync(path.dirname(activeEvidence), { recursive: true });
      fs.writeFileSync(activeEvidence, "active evidence\n", "utf-8");
      fs.writeFileSync(
        path.join(malformedArchiveTaskDir, "implement.jsonl"),
        JSON.stringify({ file: historicalEvidence, reason: "evidence" }) + "\n",
        "utf-8",
      );

      const { status, stdout } = runTaskValidate(tmp, malformedArchiveTaskDir);

      expect(status).toBe(1);
      expect(stdout).not.toContain("All validations passed");
    });
  });
});
