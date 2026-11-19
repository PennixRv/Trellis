import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createInterface } from "node:readline";
import { collectCodexTemplates } from "../configurators/codex.js";
import { renderTemplateMap } from "../configurators/shared.js";
import { getAllScripts } from "../templates/trellis/index.js";

type ObjectValue = Record<string, unknown>;
export interface ProjectInitOptions {
  trustCodex?: boolean;
  codegraph?: boolean;
}
export interface ProjectInitPlan {
  trustCodex: boolean;
  codegraph: boolean;
  codexCommand?: string;
  graphCommand?: string;
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project initialization response");
  return value as ObjectValue;
}
function executable(name: string, cwd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const real = fs.realpathSync(candidate);
      const rel = path.relative(cwd, real);
      if (
        !rel ||
        (!rel.startsWith(`..${path.sep}`) &&
          rel !== ".." &&
          !path.isAbsolute(rel))
      )
        throw new Error(`Refusing project-provided executable: ${name}`);
      return real;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing"))
        throw error;
    }
  }
  return undefined;
}
function capture(
  command: string,
  args: string[],
  cwd: string,
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Could not run ${path.basename(command)}`);
  return result;
}
export function resolveProjectPolicy(
  cwd: string,
  options: ProjectInitOptions,
): ProjectInitPlan {
  let policy = { codex_trust: false, codegraph: false };
  const config = path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "pennix/workflow.config",
  );
  if (
    (options.trustCodex === undefined || options.codegraph === undefined) &&
    fs.existsSync(config)
  ) {
    const pennix = executable("pennix", cwd);
    if (!pennix)
      throw new Error("Lifecycle declaration exists but pennix is unavailable");
    const help = capture(pennix, ["config", "--help"], cwd);
    if (!/\bpolicy\b/.test(help.stdout)) {
      if (help.status !== 0)
        throw new Error("Could not inspect Lifecycle policy capability");
      console.warn(
        "Lifecycle has no project policy capability; automatic project setup remains unselected.",
      );
    } else {
      const result = capture(pennix, ["config", "policy", "--json"], cwd);
      if (result.status !== 0)
        throw new Error(
          "Lifecycle project policy query failed; check the declaration",
        );
      const value = object(JSON.parse(result.stdout));
      const selected = object(value.project_init);
      if (
        value.schema_version !== 1 ||
        typeof selected.codex_trust !== "boolean" ||
        typeof selected.codegraph !== "boolean"
      )
        throw new Error("Unsupported Lifecycle project policy response");
      policy = {
        codex_trust: selected.codex_trust,
        codegraph: selected.codegraph,
      };
    }
  }
  return {
    trustCodex: options.trustCodex ?? policy.codex_trust,
    codegraph: options.codegraph ?? policy.codegraph,
  };
}

function verifyAssets(cwd: string, complete: boolean): void {
  const templates = renderTemplateMap(collectCodexTemplates());
  for (const [name, content] of renderTemplateMap(getAllScripts()))
    templates.set(`.trellis/scripts/${name}`, content);
  for (const [name, content] of templates) {
    if (
      !(
        name.startsWith(".codex/hooks/") ||
        name === ".codex/hooks.json" ||
        name.startsWith(".trellis/scripts/")
      )
    )
      continue;
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) {
      if (complete)
        throw new Error(`Missing managed initialization asset: ${name}`);
      continue;
    }
    if (
      !fs.lstatSync(file).isFile() ||
      fs.realpathSync(file) !== file ||
      fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") !==
        content.replace(/\r\n/g, "\n")
    )
      throw new Error(
        `Modified or redirected managed initialization asset: ${name}`,
      );
  }
}

export async function preflightProjectInit(
  cwd: string,
  plan: ProjectInitPlan,
): Promise<void> {
  if (!plan.trustCodex && !plan.codegraph) return;
  if (
    process.platform !== "linux" ||
    fs.realpathSync(cwd) === fs.realpathSync(os.homedir()) ||
    path.dirname(cwd) === cwd ||
    /^\/mnt\/[a-z](\/|$)/i.test(cwd)
  )
    throw new Error(
      "Automatic project setup requires a specific Linux filesystem project directory",
    );
  const git = executable("git", cwd);
  if (git) {
    const root = capture(git, ["rev-parse", "--show-toplevel"], cwd);
    const parent = capture(
      git,
      ["rev-parse", "--show-superproject-working-tree"],
      cwd,
    );
    if (
      (root.status === 0 && fs.realpathSync(root.stdout.trim()) !== cwd) ||
      parent.stdout.trim()
    )
      throw new Error(
        "Project initialization would use a broader Git trust root; select that root explicitly",
      );
  }
  if (plan.trustCodex) {
    const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    const actualHome = fs.existsSync(home)
      ? fs.realpathSync(home)
      : path.resolve(home);
    if (
      !path.isAbsolute(home) ||
      actualHome === cwd ||
      actualHome.startsWith(cwd + path.sep) ||
      cwd.startsWith(actualHome + path.sep)
    )
      throw new Error(
        "CODEX_HOME must be an absolute configuration directory outside the project",
      );
    plan.codexCommand = executable("codex", cwd);
    if (!plan.codexCommand)
      throw new Error(
        "Codex is unavailable; deploy it through its system owner first",
      );
    verifyAssets(cwd, false);
    const client = new CodexConfigClient(plan.codexCommand, cwd);
    try {
      await client.initialize();
      projectConfig(
        await client.request("config/read", { cwd, includeLayers: true }),
        cwd,
      );
    } finally {
      await client.close();
    }
  }
  if (plan.codegraph) {
    plan.graphCommand = executable("codegraph", cwd);
    if (!plan.graphCommand)
      throw new Error(
        "CodeGraph is unavailable; deploy it through Lifecycle first",
      );
    for (const command of [
      "init",
      "index",
      "sync",
      "status",
      "install",
      "serve",
    ]) {
      const help = capture(plan.graphCommand, [command, "--help"], cwd);
      if (
        help.status !== 0 ||
        !help.stdout.includes("--project-only") ||
        (command === "init" && !help.stdout.includes("--no-git-hooks"))
      )
        throw new Error(
          "CodeGraph lacks project initialization capabilities; upgrade through Lifecycle first",
        );
    }
    if (process.env.CODEGRAPH_NO_WATCH === "1")
      throw new Error(
        "CodeGraph file watching is explicitly disabled; automatic setup will not override it",
      );
  }
}

export class CodexConfigClient {
  private process;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(command: string, cwd: string) {
    this.process = spawn(command, ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lines = createInterface({ input: this.process.stdout });
    lines.on("line", (line) => {
      try {
        if (line.length > 4 * 1024 * 1024)
          throw new Error("Oversized Codex response");
        const response = object(JSON.parse(line));
        const pending = this.pending.get(Number(response.id));
        if (!pending) return;
        this.pending.delete(Number(response.id));
        clearTimeout(pending.timer);
        if (response.error)
          pending.reject(new Error("Codex rejected the configuration request"));
        else pending.resolve(response.result);
      } catch {
        this.fail();
      }
    });
    this.process.on("error", () => this.fail());
    this.process.stdin.on("error", () => this.fail());
    this.process.on("exit", () => {
      lines.close();
      this.fail();
    });
  }
  private fail(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          "Codex configuration service closed or returned invalid data",
        ),
      );
    }
    this.pending.clear();
  }
  async request(method: string, params: ObjectValue): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "trellis-project-init", version: "1" },
      capabilities: { experimentalApi: true },
    });
    this.process.stdin.write('{"method":"initialized"}\n');
  }
  async close(): Promise<void> {
    this.fail();
    this.process.stdin.end();
    this.process.kill("SIGTERM");
    if (
      !this.process.pid ||
      this.process.exitCode !== null ||
      this.process.signalCode !== null
    )
      return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.process.kill("SIGKILL"), 5000);
      this.process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function projectConfig(
  value: unknown,
  cwd: string,
): { user: ObjectValue; version: string } {
  const response = object(value);
  if (!Array.isArray(response.layers))
    throw new Error("Codex did not return configuration provenance");
  let user: ObjectValue | undefined, version: string | undefined;
  for (const item of response.layers) {
    const layer = object(item),
      name = object(layer.name),
      config = object(layer.config);
    if (name.type === "user") {
      user = config;
      if (typeof layer.version === "string") version = layer.version;
    }
    if (name.type !== "project") continue;
    if (name.dotCodexFolder !== path.join(cwd, ".codex"))
      throw new Error("Unexpected ancestor project configuration");
    if (
      Object.keys(config).some(
        (k) =>
          !["agents", "project_doc_fallback_filenames", "mcp_servers"].includes(
            k,
          ),
      )
    )
      throw new Error("Unknown project configuration requires review");
    if (
      config.agents &&
      JSON.stringify(config.agents) !== JSON.stringify({ enabled: false })
    )
      throw new Error("Custom project agent configuration requires review");
    if (
      config.project_doc_fallback_filenames &&
      JSON.stringify(config.project_doc_fallback_filenames) !==
        JSON.stringify(["AGENTS.md"])
    )
      throw new Error("Custom instruction fallback requires review");
    if (config.mcp_servers) {
      const servers = object(config.mcp_servers);
      if (Object.keys(servers).some((k) => k !== "codegraph"))
        throw new Error("Unknown project MCP configuration requires review");
      const graph = object(servers.codegraph);
      const command = executable("codegraph", cwd);
      if (
        graph.enabled === false ||
        !command ||
        typeof graph.command !== "string" ||
        (graph.command !== "codegraph" &&
          (!path.isAbsolute(graph.command) ||
            fs.realpathSync(graph.command) !== command)) ||
        !Array.isArray(graph.args)
      )
        throw new Error(
          "CodeGraph project connection is disabled or has an unexpected binding",
        );
      const args = [...graph.args];
      if (args.shift() !== "serve" || args.shift() !== "--mcp")
        throw new Error("Custom CodeGraph command requires review");
      while (args.length) {
        const flag = args.shift();
        if (flag === "--project-only") continue;
        if (
          (flag === "--path" || flag === "--bound-worktree") &&
          args.shift() === cwd
        )
          continue;
        throw new Error("Custom CodeGraph arguments require review");
      }
      if (
        Object.keys(graph).some(
          (k) => !["command", "args", "enabled"].includes(k),
        )
      )
        throw new Error(
          "Custom CodeGraph project configuration requires review",
        );
    }
  }
  if (!user || !version)
    throw new Error("Codex user configuration version is unavailable");
  if (object(user.features ?? {}).hooks !== true)
    throw new Error(
      "Codex hooks are disabled; retain the user choice and configure through its owner",
    );
  const projects = object(user.projects ?? {});
  const selected = object(projects[cwd] ?? {});
  if (selected.trust_level && selected.trust_level !== "trusted")
    throw new Error("Project has an explicit untrusted choice");
  if (selected.trust_level !== "trusted") {
    for (const [parent, value] of Object.entries(projects)) {
      if (
        path.isAbsolute(parent) &&
        cwd.startsWith(parent + path.sep) &&
        object(value).trust_level === "untrusted"
      )
        throw new Error("Project has an inherited explicit untrusted choice");
    }
  }
  return { user, version };
}

async function trustProject(cwd: string, plan: ProjectInitPlan): Promise<void> {
  verifyAssets(cwd, true);
  if (!plan.codexCommand) throw new Error("Codex capability was not checked");
  const client = new CodexConfigClient(plan.codexCommand, cwd);
  try {
    await client.initialize();
    const read = async (): Promise<{ user: ObjectValue; version: string }> =>
      projectConfig(
        await client.request("config/read", { cwd, includeLayers: true }),
        cwd,
      );
    let state = await read();
    if (
      object(object(state.user.projects ?? {})[cwd] ?? {}).trust_level !==
      "trusted"
    ) {
      await client.request("config/batchWrite", {
        edits: [
          {
            keyPath: `projects.${JSON.stringify(cwd)}.trust_level`,
            value: "trusted",
            mergeStrategy: "replace",
          },
        ],
        expectedVersion: state.version,
        reloadUserConfig: true,
      });
      state = await read();
    }
    const inventory = async (): Promise<ObjectValue[]> => {
      const response = object(
        await client.request("hooks/list", { cwds: [cwd] }),
      );
      if (!Array.isArray(response.data))
        throw new Error("Invalid Codex Hook inventory");
      return response.data.flatMap((entry) => {
        const item = object(entry);
        if (
          item.cwd !== cwd ||
          !Array.isArray(item.hooks) ||
          (Array.isArray(item.errors) && item.errors.length)
        )
          throw new Error("Codex Hook inventory is incomplete");
        return item.hooks.map(object);
      });
    };
    const hooks = (await inventory()).filter(
      (h) =>
        h.source === "project" &&
        h.sourcePath === path.join(cwd, ".codex/hooks.json"),
    );
    const expectedText = renderTemplateMap(collectCodexTemplates()).get(
      ".codex/hooks.json",
    );
    if (!expectedText)
      throw new Error("Bundled Trellis Hook definitions are unavailable");
    const expected = object(JSON.parse(expectedText));
    const count = Object.values(object(expected.hooks)).reduce<number>(
      (sum, groups) =>
        sum +
        (groups as { hooks: unknown[] }[]).reduce(
          (n, group) => n + group.hooks.length,
          0,
        ),
      0,
    );
    if (
      hooks.length !== count ||
      hooks.some(
        (h) =>
          h.enabled !== true ||
          h.handlerType !== "command" ||
          typeof h.key !== "string" ||
          typeof h.currentHash !== "string",
      )
    )
      throw new Error(
        "Managed Trellis Hook inventory is disabled or incomplete",
      );
    const approvals: ObjectValue = {};
    for (const hook of hooks) {
      if (hook.trustStatus !== "trusted")
        approvals[String(hook.key)] = { trusted_hash: hook.currentHash };
    }
    if (Object.keys(approvals).length) {
      verifyAssets(cwd, true);
      await client.request("config/batchWrite", {
        edits: [
          { keyPath: "hooks.state", value: approvals, mergeStrategy: "upsert" },
        ],
        expectedVersion: state.version,
        reloadUserConfig: true,
      });
    }
    const after = await inventory();
    if (
      hooks.some(
        (h) =>
          !after.some(
            (a) =>
              a.key === h.key &&
              a.currentHash === h.currentHash &&
              a.trustStatus === "trusted" &&
              a.enabled === true,
          ),
      )
    )
      throw new Error("Codex Hook trust readback did not match");
    console.log("Codex project trust and managed Trellis Hooks: ready");
  } finally {
    await client.close();
  }
}

function graphStatus(command: string, cwd: string): ObjectValue {
  const result = capture(
    command,
    ["status", cwd, "--json", "--project-only"],
    cwd,
  );
  if (result.status !== 0)
    throw new Error("CodeGraph status failed; inspect with its native CLI");
  const status = object(JSON.parse(result.stdout));
  if (status.projectPath !== cwd)
    throw new Error("CodeGraph returned a different project root");
  return status;
}
async function runGraph(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", () => reject(new Error("Could not start CodeGraph")));
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "CodeGraph initialization step failed; keep completed assets and retry native init",
            ),
          ),
    );
  });
}
export async function completeProjectInit(
  cwd: string,
  plan: ProjectInitPlan,
): Promise<void> {
  if (!plan.trustCodex && !plan.codegraph) return;
  if (!fs.existsSync(path.join(cwd, ".codex/config.toml"))) return;
  await preflightProjectInit(cwd, plan);
  if (plan.codegraph) {
    if (!plan.graphCommand)
      throw new Error("CodeGraph capability was not checked");
    const args = [
      "install",
      "--target",
      "codex",
      "--location",
      "local",
      "--yes",
      "--project-only",
    ];
    const git = executable("git", cwd);
    if (git && capture(git, ["rev-parse", "--show-toplevel"], cwd).status === 0)
      args.push("--bound-worktree", cwd);
    await runGraph(plan.graphCommand, args, cwd);
  }
  if (plan.trustCodex) await trustProject(cwd, plan);
  if (plan.codegraph) {
    const command = plan.graphCommand;
    if (!command) throw new Error("CodeGraph capability was not checked");
    let status = graphStatus(command, cwd);
    if (status.rebuildInProgress)
      throw new Error(
        "CodeGraph has an active writer; retry after it finishes",
      );
    if (!status.initialized)
      await runGraph(
        command,
        [
          "init",
          cwd,
          "--yes",
          "--local-only",
          "--project-only",
          "--no-git-hooks",
        ],
        cwd,
      );
    else {
      const index = object(status.index);
      if (
        index.state !== "complete" ||
        index.reindexRecommended === true ||
        Number(index.pendingRefs) > 0
      )
        await runGraph(
          command,
          ["index", cwd, "--project-only", "--quiet"],
          cwd,
        );
      else if (
        Object.values(object(status.pendingChanges)).some(
          (n) => typeof n === "number" && n > 0,
        ) ||
        Number(index.filesNeedingReindex) > 0
      )
        await runGraph(command, ["sync", cwd, "--project-only"], cwd);
    }
    status = graphStatus(command, cwd);
    const strict = capture(
      command,
      ["status", cwd, "--json", "--strict", "--project-only"],
      cwd,
    );
    if (strict.status !== 0 || object(status.index).state !== "complete")
      throw new Error(
        "CodeGraph index is not ready; inspect its native status",
      );
    const inventory = capture(command, ["files", "--path", cwd, "--json"], cwd);
    const files: unknown = JSON.parse(inventory.stdout);
    if (inventory.status !== 0 || !Array.isArray(files))
      throw new Error("CodeGraph file coverage could not be verified");
    if (
      !files.some((file) => {
        const name = object(file).path;
        return (
          typeof name === "string" &&
          ![".trellis/", ".codex/", ".agents/"].some((prefix) =>
            name.startsWith(prefix),
          )
        );
      })
    )
      console.log(
        "No supported project source is indexed yet; workflow helpers do not establish business-code coverage.",
      );
    console.log(
      "CodeGraph project connection and index: ready. MCP loading and live sync require a new host session.",
    );
  }
  if (!fs.existsSync(path.join(cwd, ".trellis/.developer")))
    throw new Error(
      "Project tools prepared, but Trellis developer identity is incomplete; rerun init with --user",
    );
  console.log(
    "Trellis assets: ready. Keep the native bootstrap/onboarding task for project guideline development.",
  );
}
