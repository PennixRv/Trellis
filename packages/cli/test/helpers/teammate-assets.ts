import fs from "node:fs";
import path from "node:path";

import { getAllAgents, teamworkConfigTemplate } from "../../src/templates/trellis/index.js";
import { resolveTeammateProfile, type TeammateProvider } from "../../src/commands/teamwork/profiles.js";
import { buildTeammateLaunchSpec } from "../../src/commands/teamwork/teammate-launch.js";
import { CLI_TEAMMATE_HOST } from "../../src/commands/teamwork/runtime.js";

export function installTeammateAssets(cwd: string): void {
  for (const [relative, content] of getAllAgents()) {
    const file = path.join(cwd, ".trellis/agents", relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(path.join(cwd, ".trellis/teamwork.json"), teamworkConfigTemplate);
}

export function frozenExecution(cwd: string, provider: TeammateProvider = "codex") {
  const profile = resolveTeammateProfile({ cwd, profile: "review", provider });
  const launch = buildTeammateLaunchSpec({ cwd, profile, host: CLI_TEAMMATE_HOST });
  return { profile, launch };
}
