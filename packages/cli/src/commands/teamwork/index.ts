import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { InvalidArgumentError, type Command } from "commander";

import { isProvider, listProviders, type Provider } from "./adapters/index.js";
import { parseCodexSandboxMode } from "./adapters/codex.js";
import {
  REASONING_EFFORTS,
  resolveTeammateProfile,
  type ReasoningEffort,
} from "./profiles.js";
import {
  resolveCoordination,
  COORDINATION_MODES,
  type CoordinationMode,
} from "./coordination.js";
import { constructTeamworkPlan } from "./plan.js";
import { CLI_TEAMMATE_HOST } from "./runtime.js";
import { teamworkBatch } from "./batch.js";
import {
  teamworkSessionContextAdd,
  teamworkSessionContextDelete,
  teamworkSessionContextList,
} from "./context.js";
import { createTeamworkSession } from "./create.js";
import { parseTrace } from "./dev-parse-trace.js";
import { teamworkSessionKill } from "./kill.js";
import { teamworkSessionInterrupt } from "./interrupt.js";
import { teamworkSessionList } from "./list.js";
import { teamworkSessionMessages } from "./messages.js";
import { teamworkSessionPrune, teamworkSessionRm } from "./rm.js";
import { teamworkSessionSend } from "./send.js";
import { teamworkSessionRun } from "./run.js";
import { teamworkSessionSpawn } from "./spawn.js";
import {
  teamworkSessionThreadPost,
  teamworkSessionThreadRename,
  teamworkSessionThreadShow,
  teamworkSessionForumList,
} from "./threads.js";
import { teamworkSessionTitleClear, teamworkSessionTitleSet } from "./title.js";
import { runSupervisor } from "./supervisor.js";
import { teamworkSessionWait, parseDuration } from "./wait.js";
import { parseCsv } from "./store/schema.js";
import { parseInboxPolicy } from "@pennixrv/trellis-core/teamwork";

function parseNonNegativeInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(
      `expected a non-negative integer, got '${value}'`,
    );
  }
  return Number(value);
}

function parseReasoningEffort(value: string): ReasoningEffort {
  if (!REASONING_EFFORTS.includes(value as ReasoningEffort))
    throw new InvalidArgumentError(
      `reasoning effort must be one of ${REASONING_EFFORTS.join(", ")}`,
    );
  return value as ReasoningEffort;
}

export function registerTeamworkCommand(program: Command): void {
  const teamwork = program
    .command("teamwork")
    .description(
      "Trellis Teamwork runtime — coordinate teammates through a shared event log",
    );

  teamwork
    .command("config")
    .description(
      "Resolve the project profile, execution configuration, and coordination defaults",
    )
    .option("--profile <name>", "professional profile")
    .option(
      "--configuration <name>",
      "candidate configuration within the profile",
    )
    .option("--mode <mode>", "general | advisor | committee")
    .action(
      (options: {
        profile?: string;
        configuration?: string;
        mode?: string;
      }) => {
        if (
          options.mode &&
          !COORDINATION_MODES.includes(options.mode as CoordinationMode)
        )
          throw new InvalidArgumentError(
            "mode must be general, advisor, or committee",
          );
        const profile = resolveTeammateProfile({
          cwd: process.cwd(),
          ...options,
        });
        console.log(
          JSON.stringify({
            profile: profile.profile,
            configuration: profile.configuration,
            provider: profile.provider,
            model: profile.model,
            reasoning_effort: profile.reasoningEffort,
            options: profile.options,
            role_path: profile.rolePath,
            professional_role_path: profile.professionalRolePath,
            coordination: resolveCoordination(
              process.cwd(),
              options.mode as CoordinationMode | undefined,
            ),
          }),
        );
      },
    );

  teamwork
    .command("create <name>")
    .description("Create a Teamwork session")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--type <type>", "session type: chat | forum", "chat")
    .option("--task <path>", "associated Trellis task directory")
    .option("--project <slug>", "project slug")
    .option("--labels <csv>", "comma-separated labels")
    .option("--description <text>", "stable Teamwork session description")
    .option(
      "--context-file <absolute-path>",
      "absolute file path attached as Teamwork session context (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option(
      "--context-raw <text>",
      "raw Teamwork session context text (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option("--cwd <path>", "working directory recorded in the create event")
    .option("--by <agent>", "agent name recorded as the creator", "main")
    .option(
      "--force",
      "overwrite an existing Teamwork session with the same name",
    )
    .option(
      "--ephemeral",
      "mark as ephemeral — hidden from `teamwork list` by default and cleanable via `teamwork prune --ephemeral`",
    )
    .action(
      async (
        name: string,
        opts: {
          task?: string;
          project?: string;
          labels?: string;
          scope?: string;
          type?: string;
          description?: string;
          contextFile?: string[];
          contextRaw?: string[];
          cwd?: string;
          by?: string;
          force?: boolean;
          ephemeral?: boolean;
        },
      ) => {
        try {
          await createTeamworkSession(name, opts);
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  teamwork
    .command("send <name>")
    .description("Send a message in a Teamwork session")
    .requiredOption("--as <agent>", "agent name sending")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option(
      "--to <agents>",
      "comma-separated target agents (default: broadcast)",
    )
    .option("--stdin", "read message body from stdin")
    .option("--text-file <path>", "read message body from file")
    .option(
      "--delivery-mode <mode>",
      "targeted delivery validation: appendOnly | requireKnownWorker | requireRunningWorker",
    )
    .argument(
      "[text]",
      "inline text body (otherwise use --stdin / --text-file)",
    )
    .action(
      async (
        name: string,
        text: string | undefined,
        raw: Record<string, unknown>,
      ) => {
        const opts = raw as {
          as: string;
          scope?: string;
          to?: string;
          stdin?: boolean;
          textFile?: string;
          deliveryMode?: string;
        };
        try {
          await teamworkSessionSend(name, {
            as: opts.as,
            text,
            stdin: opts.stdin,
            textFile: opts.textFile,
            scope: opts.scope,
            to: opts.to,
            deliveryMode: opts.deliveryMode,
          });
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  teamwork
    .command("wait <name>")
    .description("Block until an event matching the filter arrives, or timeout")
    .requiredOption("--as <agent>", "agent name waiting")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--timeout <duration>", "max wait (e.g. 30s, 2m, 1h)")
    .option("--from <agents>", "only wake on events from these agents (CSV)")
    .option(
      "--kind <kind[,kind...]>",
      "only wake on these event kinds (CSV, OR semantics)",
    )
    .option("--thread <key>", "only wake on this thread key")
    .option("--action <action>", "only wake on this thread action")
    .option(
      "--to <target>",
      "only wake on events targeted to this name (default: own agent)",
    )
    .option("--include-progress", "also wake on progress events")
    .option(
      "--all",
      "wait until each agent in --from has produced a matching event (default: first match wins)",
    )
    .action(async (name: string, raw: Record<string, unknown>) => {
      const opts = raw as {
        as: string;
        timeout?: string;
        from?: string;
        kind?: string;
        scope?: string;
        thread?: string;
        action?: string;
        to?: string;
        includeProgress?: boolean;
        all?: boolean;
      };
      try {
        await teamworkSessionWait(name, {
          as: opts.as,
          timeoutMs: parseDuration(opts.timeout),
          from: opts.from,
          kind: opts.kind,
          scope: opts.scope,
          thread: opts.thread,
          action: opts.action,
          to: opts.to,
          includeProgress: opts.includeProgress,
          all: opts.all,
        });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("interrupt <name>")
    .description("Interrupt a teammate turn and send a replacement instruction")
    .requiredOption("--as <agent>", "agent name requesting the interrupt")
    .requiredOption("--to <agent>", "target teammate name")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--stdin", "read interrupt message body from stdin")
    .option("--text-file <path>", "read interrupt message body from file")
    .argument(
      "[text]",
      "inline interrupt message (otherwise use --stdin / --text-file)",
    )
    .action(
      async (
        name: string,
        text: string | undefined,
        raw: Record<string, unknown>,
      ) => {
        const opts = raw as {
          as: string;
          to: string;
          scope?: string;
          stdin?: boolean;
          textFile?: string;
        };
        try {
          await teamworkSessionInterrupt(name, {
            as: opts.as,
            to: opts.to,
            text,
            stdin: opts.stdin,
            textFile: opts.textFile,
            scope: opts.scope,
          });
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  teamwork
    .command("spawn <name>")
    .description(
      "Register a teammate process in a Teamwork session; waits for the first targeted message",
    )
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option(
      "--agent <agent-name>",
      "load .trellis/agents/<name>.md (sets default --provider / --model / system prompt)",
    )
    .option(
      "--provider <provider>",
      "teammate provider: claude | codex | copilot | dsh",
    )
    .option(
      "--as <name>",
      "teammate name in the Teamwork session (default: <agent-name> if --agent is set)",
    )
    .option("--cwd <path>", "teammate working directory (default: process cwd)")
    .option("--model <id>", "model override")
    .option("--profile <id>", "professional teammate profile")
    .option("--configuration <id>", "configuration within the selected profile")
    .option(
      "--reasoning-effort <effort>",
      "provider reasoning effort override",
      parseReasoningEffort,
    )
    .option("--resume <id>", "resume an existing session/thread id")
    .option(
      "--sandbox <mode>",
      "codex-only: teammate sandbox mode: read-only | workspace-write | danger-full-access (default workspace-write)",
    )
    .option(
      "--timeout <duration>",
      "auto-kill teammate process after this duration (e.g. 30m, 1h, 7200s)",
    )
    .option(
      "--warn-before <duration>",
      "emit supervisor_warning before timeout (default 5m; 0ms disables)",
    )
    .option(
      "--file <path>",
      "include a file's content as context in the teammate's system prompt (glob supported, repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option(
      "--jsonl <path>",
      "parse a Trellis jsonl manifest ({file, reason} per line) and include each referenced file (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option(
      "--by <agent>",
      "identity recorded as the spawn author (defaults to TRELLIS_TEAMWORK_AS env or 'main')",
    )
    .option(
      "--inbox-policy <policy>",
      "teammate inbox delivery policy: explicitOnly | broadcastAndExplicit (default explicitOnly)",
    )
    .option(
      "--idle-timeout <duration>",
      "OOM-guard idle-cleanup TTL for this teammate (default 5m; 0 disables)",
    )
    .option(
      "--max-live-teammates <n>",
      "spawn-time live-teammate budget for this project/scope (default 6; 0 disables)",
      parseNonNegativeInteger,
    )
    .action(async (name: string, raw: Record<string, unknown>) => {
      const opts = raw as {
        agent?: string;
        provider?: string;
        as?: string;
        cwd?: string;
        model?: string;
        profile?: string;
        configuration?: string;
        reasoningEffort?: ReasoningEffort;
        resume?: string;
        sandbox?: string;
        timeout?: string;
        warnBefore?: string;
        file?: string[];
        jsonl?: string[];
        by?: string;
        scope?: string;
        inboxPolicy?: string;
        idleTimeout?: string;
        maxLiveTeammates?: number;
      };
      if (opts.provider !== undefined && !isProvider(opts.provider)) {
        console.error(
          chalk.red("Error:"),
          `--provider must be one of: ${listProviders().join(", ")}`,
        );
        process.exit(1);
      }
      try {
        const sandbox = parseCodexSandboxMode(opts.sandbox);
        await teamworkSessionSpawn(name, {
          agent: opts.agent,
          provider: opts.provider as Provider | undefined,
          as: opts.as,
          cwd: opts.cwd,
          model: opts.model,
          profile: opts.profile,
          configuration: opts.configuration,
          reasoningEffort: opts.reasoningEffort,
          resume: opts.resume,
          sandbox,
          timeoutMs: parseDuration(opts.timeout),
          warnBeforeMs: parseDuration(opts.warnBefore),
          files: opts.file,
          jsonls: opts.jsonl,
          by: opts.by,
          scope: opts.scope,
          inboxPolicy: parseInboxPolicy(opts.inboxPolicy),
          idleTimeoutMs: parseDuration(opts.idleTimeout),
          maxLiveWorkers: opts.maxLiveTeammates,
        });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("plan <spec>")
    .description(
      "Resolve project configuration and publish an immutable Teamwork plan and briefs",
    )
    .requiredOption("--task <path>", "current task directory")
    .requiredOption("--output <path>", "new plan file")
    .option(
      "--dry-run",
      "validate and resolve without writing files or starting processes",
    )
    .action(
      (
        spec: string,
        opts: { task: string; output: string; dryRun?: boolean },
      ) => {
        const plan = constructTeamworkPlan({
          draft: JSON.parse(fs.readFileSync(spec, "utf8")),
          cwd: process.cwd(),
          taskRoot: path.resolve(opts.task),
          output: path.resolve(opts.output),
          host: CLI_TEAMMATE_HOST,
          dryRun: opts.dryRun,
        });
        console.log(JSON.stringify(plan));
      },
    );

  teamwork
    .command("batch <plan>")
    .description(
      "Execute a frozen Teamwork plan through foreground provider processes",
    )
    .requiredOption("--task <path>", "current task directory")
    .option(
      "--preflight",
      "read-only validation; creates no files or provider processes",
    )
    .action(
      async (planPath: string, opts: { task: string; preflight?: boolean }) => {
        try {
          await teamworkBatch(planPath, opts);
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  teamwork
    .command("run [name]")
    .description(
      "One-shot: create an ephemeral Teamwork session, start a teammate, send the prompt, wait for completion, print the answer, and clean up",
    )
    .option(
      "--agent <agent-name>",
      "load .trellis/agents/<name>.md (sets default --provider / --as / system prompt)",
    )
    .option(
      "--provider <provider>",
      "teammate provider: claude | codex | copilot | dsh",
    )
    .option("--as <name>", "teammate name (default: agent name if --agent set)")
    .option("--cwd <path>", "teammate working directory")
    .option("--model <id>", "model override")
    .option("--profile <id>", "professional teammate profile")
    .option("--configuration <id>", "configuration within the selected profile")
    .option(
      "--reasoning-effort <effort>",
      "provider reasoning effort override",
      parseReasoningEffort,
    )
    .option(
      "--file <path>",
      "include a file as context (glob supported, repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option(
      "--jsonl <path>",
      "parse a Trellis jsonl manifest and include each referenced file (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option("--message <text>", "inline prompt text")
    .option("--message-file <path>", "read prompt body from file")
    .option("--stdin", "read prompt body from stdin")
    .option(
      "--timeout <duration>",
      "max time to wait for done (e.g. 30s, 5m, 1h; default 5m)",
    )
    .action(async (name: string | undefined, raw: Record<string, unknown>) => {
      const opts = raw as {
        agent?: string;
        provider?: string;
        as?: string;
        cwd?: string;
        model?: string;
        profile?: string;
        configuration?: string;
        reasoningEffort?: ReasoningEffort;
        file?: string[];
        jsonl?: string[];
        message?: string;
        messageFile?: string;
        stdin?: boolean;
        timeout?: string;
      };
      if (opts.provider !== undefined && !isProvider(opts.provider)) {
        console.error(
          chalk.red("Error:"),
          `--provider must be one of: ${listProviders().join(", ")}`,
        );
        process.exit(1);
      }
      try {
        await teamworkSessionRun({
          name,
          agent: opts.agent,
          provider: opts.provider as Provider | undefined,
          as: opts.as,
          cwd: opts.cwd,
          model: opts.model,
          profile: opts.profile,
          configuration: opts.configuration,
          reasoningEffort: opts.reasoningEffort,
          files: opts.file,
          jsonls: opts.jsonl,
          message: opts.message,
          textFile: opts.messageFile,
          stdin: opts.stdin,
          timeoutMs: parseDuration(opts.timeout),
        });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("rm <name>")
    .description(
      "Stop teammate processes and delete a Teamwork session entirely",
    )
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionRm(name, raw as { scope?: string });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("prune")
    .description(
      "Bulk-remove Teamwork sessions by criteria (defaults to dry-run preview)",
    )
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option(
      "--all",
      "remove all Teamwork sessions (except live ones and --keep)",
    )
    .option(
      "--empty",
      "remove Teamwork sessions with no activity (only create event)",
    )
    .option(
      "--idle <duration>",
      "remove sessions whose last event is older than this (e.g. 1h, 7d)",
    )
    .option(
      "--ephemeral",
      "remove only sessions marked `--ephemeral` at create time",
    )
    .option("--yes", "actually delete (default is dry-run)")
    .option("--dry-run", "show what would be removed without deleting", true)
    .option(
      "--keep <names>",
      "comma-separated Teamwork session names to keep regardless",
    )
    .action(async (raw: Record<string, unknown>) => {
      const opts = raw as {
        all?: boolean;
        empty?: boolean;
        idle?: string;
        ephemeral?: boolean;
        yes?: boolean;
        dryRun?: boolean;
        keep?: string;
        scope?: string;
      };
      try {
        await teamworkSessionPrune({
          all: opts.all,
          empty: opts.empty,
          idleMs: parseDuration(opts.idle),
          ephemeral: opts.ephemeral,
          yes: opts.yes,
          dryRun: !opts.yes,
          keep: parseCsv(opts.keep),
          scope: opts.scope,
        });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("list")
    .description(
      "List Teamwork Sessions in ~/.trellis/teamwork/ with teammate and activity summary",
    )
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--json", "emit JSON instead of a formatted table")
    .option(
      "--project <slug>",
      "filter sessions whose `task` field contains this substring",
    )
    .option(
      "--all",
      "include ephemeral sessions (default: hide sessions marked ephemeral)",
    )
    .option(
      "--all-projects",
      "scan every project bucket (default: only the current cwd's project)",
    )
    .action(async (raw: Record<string, unknown>) => {
      const opts = raw as {
        json?: boolean;
        project?: string;
        all?: boolean;
        allProjects?: boolean;
        scope?: string;
      };
      try {
        await teamworkSessionList(opts);
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("messages <name>")
    .description("View messages and events in a Teamwork session")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--raw", "print raw JSON (one event per line)")
    .option("--follow", "stream new events as they arrive (Ctrl-C to stop)")
    .option("--last <N>", "show only the last N matching events", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--since <seq>", "only events with seq > N", (v) =>
      Number.parseInt(v, 10),
    )
    .option(
      "--kind <kind>",
      "filter by event kind (e.g. message, done, killed)",
    )
    .option("--from <agents>", "filter by author (CSV)")
    .option("--to <target>", "filter by routing target")
    .option("--thread <key>", "filter by thread key")
    .option("--action <action>", "filter by thread action")
    .option("--no-progress", "hide progress events (tool calls, deltas)")
    .action(async (name: string, raw: Record<string, unknown>) => {
      const opts = raw as {
        raw?: boolean;
        follow?: boolean;
        last?: number;
        since?: number;
        kind?: string;
        from?: string;
        to?: string;
        scope?: string;
        thread?: string;
        action?: string;
        progress?: boolean; // commander negates --no-progress to progress:false
      };
      try {
        await teamworkSessionMessages(name, {
          raw: opts.raw,
          follow: opts.follow,
          last: opts.last,
          since: opts.since,
          kind: opts.kind,
          from: opts.from,
          to: opts.to,
          scope: opts.scope,
          thread: opts.thread,
          action: opts.action,
          noProgress: opts.progress === false,
        });
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("kill <name>")
    .description(
      "Stop a teammate process in the Teamwork session (SIGTERM, or SIGKILL with --force)",
    )
    .requiredOption("--as <agent>", "teammate agent name")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--force", "skip graceful shutdown, send SIGKILL immediately")
    .action(async (name: string, raw: Record<string, unknown>) => {
      const opts = raw as { as: string; force?: boolean; scope?: string };
      try {
        await teamworkSessionKill(name, opts);
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  teamwork
    .command("post <name> <action>")
    .description("Append a structured thread event to a Teamwork forum")
    .requiredOption("--as <agent>", "agent name posting")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--thread <key>", "thread key (required except opened)")
    .option("--title <text>", "thread title")
    .option("--text <text>", "event body")
    .option("--stdin", "read event body from stdin")
    .option("--text-file <path>", "read event body from file")
    .option("--description <text>", "stable thread description")
    .option("--status <status>", "thread status")
    .option("--labels <csv>", "replace thread labels")
    .option("--assignees <csv>", "replace thread assignees")
    .option("--summary <text>", "thread summary")
    .option(
      "--context-file <absolute-path>",
      "absolute file path attached as thread context (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .option(
      "--context-raw <text>",
      "raw thread context text (repeatable)",
      (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
      [] as string[],
    )
    .action(
      async (name: string, action: string, raw: Record<string, unknown>) => {
        try {
          await teamworkSessionThreadPost(name, {
            ...(raw as unknown as Parameters<
              typeof teamworkSessionThreadPost
            >[1]),
            action,
          });
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  teamwork
    .command("forum <name>")
    .description("List threads in a Teamwork forum")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--status <status>", "filter by thread status")
    .option("--raw", "print raw reduced thread JSON")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionForumList(
          name,
          raw as Parameters<typeof teamworkSessionForumList>[1],
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  const thread = teamwork
    .command("thread")
    .description("Show or mutate one thread timeline");

  thread
    .argument("<name>", "Teamwork session name")
    .argument("<thread>", "thread key")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option("--raw", "print raw thread events")
    .action(
      async (name: string, threadKey: string, raw: Record<string, unknown>) => {
        try {
          await teamworkSessionThreadShow(
            name,
            threadKey,
            raw as Parameters<typeof teamworkSessionThreadShow>[2],
          );
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  thread
    .command("rename <name> <oldThread> <newThread>")
    .description("Rename a thread inside a Teamwork forum")
    .requiredOption("--as <agent>", "agent name")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .action(
      async (
        name: string,
        oldThread: string,
        newThread: string,
        raw: Record<string, unknown>,
      ) => {
        const opts = raw as { as: string; scope?: string };
        try {
          await teamworkSessionThreadRename(name, oldThread, newThread, opts);
        } catch (err) {
          console.error(
            chalk.red("Error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  const context = teamwork
    .command("context")
    .description(
      "Manage Teamwork session-level or thread-level context entries",
    );

  const addContextOptions = (cmd: Command): Command =>
    cmd
      .option("--as <agent>", "agent name", "main")
      .option("--scope <scope>", "Teamwork session scope: project | global")
      .option(
        "--thread <key>",
        "mutate thread-level context instead of Teamwork session-level",
      )
      .option(
        "--file <absolute-path>",
        "absolute file path (repeatable)",
        (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
        [] as string[],
      )
      .option(
        "--raw <text>",
        "raw text entry (repeatable)",
        (val: string, prev: string[] | undefined) => [...(prev ?? []), val],
        [] as string[],
      );

  addContextOptions(context.command("add <name>"))
    .description("Add context entries")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionContextAdd(
          name,
          raw as unknown as Parameters<typeof teamworkSessionContextAdd>[1],
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  addContextOptions(context.command("delete <name>"))
    .description("Delete context entries")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionContextDelete(
          name,
          raw as unknown as Parameters<typeof teamworkSessionContextDelete>[1],
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  context
    .command("list <name>")
    .description("List projected current context entries")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .option(
      "--thread <key>",
      "show thread-level context instead of Teamwork session-level",
    )
    .option("--raw", "print one context entry JSON per line")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionContextList(
          name,
          raw as Parameters<typeof teamworkSessionContextList>[1],
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  const title = teamwork
    .command("title")
    .description("Set or clear the Teamwork session title");

  title
    .command("set <name>")
    .description("Set the Teamwork session title")
    .option("--as <agent>", "agent name", "main")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .requiredOption("--title <text>", "display title")
    .action(async (name: string, raw: Record<string, unknown>) => {
      const opts = raw as { as: string; scope?: string; title: string };
      try {
        await teamworkSessionTitleSet(name, opts);
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  title
    .command("clear <name>")
    .description("Clear the Teamwork session title")
    .option("--as <agent>", "agent name", "main")
    .option("--scope <scope>", "Teamwork session scope: project | global")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        await teamworkSessionTitleClear(
          name,
          raw as unknown as Parameters<typeof teamworkSessionTitleClear>[1],
        );
      } catch (err) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : err,
        );
        process.exit(1);
      }
    });

  // Hidden: supervisor entry point invoked by `teamwork spawn` via fork.
  teamwork
    .command("__supervisor <teamwork-session> <teammate> <config>")
    .description(
      "[internal] supervisor process entry point — do not invoke directly",
    )
    .action(
      async (sessionId: string, teammateName: string, configPath: string) => {
        try {
          await runSupervisor(sessionId, teammateName, configPath);
        } catch (err) {
          console.error(
            chalk.red("Supervisor error:"),
            err instanceof Error ? err.message : err,
          );
          process.exit(1);
        }
      },
    );

  // Dev-only: feed a recorded stream-json / wire trace through the matching
  // adapter and print the resulting Teamwork events. Used during adapter
  // development to verify against real-CLI fixtures.
  teamwork
    .command("__parse-trace <adapter> <file>")
    .description(
      "[dev] Run a recorded trace through the parser and print events",
    )
    .action((adapter: string, file: string) => {
      if (!isProvider(adapter)) {
        console.error(
          chalk.red("Error:"),
          `unknown adapter '${adapter}' (registered: ${listProviders().join(", ")})`,
        );
        process.exit(1);
      }
      parseTrace(adapter, file);
    });
}
