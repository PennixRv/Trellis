import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const templates = path.resolve(__dirname, "../../src/templates");

describe("workflow heading consumers", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-heading-test-"));
    fs.cpSync(
      path.join(templates, "trellis/scripts"),
      path.join(tmp, ".trellis/scripts"),
      { recursive: true },
    );
    fs.cpSync(path.join(templates, "opencode/lib"), path.join(tmp, "lib"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it.each([
    ["## Phase Index", "## Phase 1: Plan"],
    ["## 阶段索引（Phase Index）", "## 阶段一：规划（Phase 1: Plan）"],
  ])("extracts exact %s headings on every consumer", (index, phase) => {
    // Prefix decoys must not start/end the section; breadcrumb bodies must not leak.
    const workflow = `## Phase Index notes\nBEFORE_DECOY\n${index}\nSUMMARY\n${phase} appendix\nIN_RANGE\n[workflow-state:planning]\nHIDDEN_BREADCRUMB\n[/workflow-state:planning]\n${phase}\nSTEP_BODY\n`;
    const workflowPath = path.join(tmp, ".trellis/workflow.md");
    fs.writeFileSync(workflowPath, workflow);
    const outputs: string[] = [];
    for (const [platform, fn] of [
      ["shared-hooks", "_build_workflow_overview"],
      ["codex/hooks", "_build_workflow_toc"],
      ["copilot/hooks", "_build_workflow_toc"],
    ]) {
      const hook = path.join(tmp, platform, "session-start.py");
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.copyFileSync(path.join(templates, platform, "session-start.py"), hook);
      outputs.push(
        execFileSync(
          "python3",
          [
            "-c",
            "import runpy,sys; from pathlib import Path; m=runpy.run_path(sys.argv[1]); print(m[sys.argv[3]](Path(sys.argv[2])))",
            hook,
            workflowPath,
            fn,
          ],
          { cwd: tmp, encoding: "utf-8" },
        ),
      );
    }
    outputs.push(
      execFileSync(
        "python3",
        [
          "-c",
          "import sys; sys.path.insert(0, '.trellis/scripts'); from common import workflow_phase; workflow_phase._read_workflow=lambda:open(sys.argv[1],encoding='utf-8').read(); print(workflow_phase.get_phase_index())",
          workflowPath,
        ],
        { cwd: tmp, encoding: "utf-8" },
      ),
    );
    const js = `import {readFileSync} from 'node:fs'; import {buildSessionContext} from './lib/session-utils.js'; const ctx={directory:process.cwd(),getActiveTask:()=>({taskPath:null}),readProjectFile:p=>readFileSync(p,'utf-8')}; console.log(buildSessionContext(ctx));`;
    outputs.push(
      execFileSync("node", ["--input-type=module", "-e", js], {
        cwd: tmp,
        encoding: "utf-8",
      }),
    );
    for (const output of outputs) {
      expect(output).toContain(index);
      expect(output).toContain("SUMMARY");
      expect(output).toContain("IN_RANGE");
      expect(output).not.toContain("BEFORE_DECOY");
      expect(output).not.toContain("STEP_BODY");
      expect(output).not.toContain("HIDDEN_BREADCRUMB");
    }
  });
});
