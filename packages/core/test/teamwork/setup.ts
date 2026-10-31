import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TmpEnv {
  tmpDir: string;
  projectDir: string;
  cleanup(): void;
}

export function setupTeamworkSessionTmp(): TmpEnv {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-core-test-"));
  const projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir);
  process.env.TRELLIS_TEAMWORK_ROOT = path.join(tmpDir, "teamwork");
  delete process.env.TRELLIS_TEAMWORK_PROJECT;
  return {
    tmpDir,
    projectDir,
    cleanup: () => {
      delete process.env.TRELLIS_TEAMWORK_ROOT;
      delete process.env.TRELLIS_TEAMWORK_PROJECT;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
