/**
 * `trellis teamwork list` — table summary of Teamwork Sessions in `~/.trellis/teamwork/`.
 *
 * Columns: name, created (ts), teammates (alive/total), last activity, task.
 * Sorted by most recent activity first.
 */

import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";

import {
  isCreateEvent,
  reduceTeamworkSessionMetadata,
  type TeamworkEvent,
  type CreateTeamworkEvent,
} from "./store/events.js";
import {
  sessionDir,
  currentProjectKey,
  listProjects,
  projectDir,
} from "./store/paths.js";
import {
  GLOBAL_PROJECT_KEY,
  parseTeamworkSessionScope,
} from "./store/schema.js";

interface TeamworkSessionSummary {
  name: string;
  /** Project bucket containing this Teamwork Session. Useful with `--all-projects`. */
  project: string;
  createdAt?: string;
  task?: string;
  workersAlive: number;
  workersTotal: number;
  lastEventTs?: string;
  lastEventKind?: string;
  totalEvents: number;
  ephemeral: boolean;
  type: string;
  description?: string;
}

export interface ListOptions {
  json?: boolean;
  project?: string;
  /** Include ephemeral Teamwork Sessions in the output (default: hide them). */
  all?: boolean;
  /** Scan every project bucket, not just the current cwd's. */
  allProjects?: boolean;
  scope?: string;
}

export async function teamworkSessionList(
  opts: ListOptions = {},
): Promise<void> {
  const scope = parseTeamworkSessionScope(opts.scope);
  const projects =
    scope === "global"
      ? [GLOBAL_PROJECT_KEY]
      : opts.allProjects
        ? listProjects()
        : [currentProjectKey()];

  const summaries: TeamworkSessionSummary[] = [];
  for (const project of projects) {
    const dir = projectDir(project);
    if (!fs.existsSync(dir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => {
        if (n.startsWith(".")) return false; // skip .bucket marker etc.
        try {
          return fs.statSync(path.join(dir, n)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      continue;
    }
    for (const name of names) {
      const s = summarize(name, project);
      if (s) summaries.push(s);
    }
  }

  // Filter by project (matches task substring for now)
  const projectFilter = opts.project;
  let filtered = projectFilter
    ? summaries.filter((s) => s.task?.includes(projectFilter))
    : summaries;
  // Hide ephemeral Teamwork Sessions unless --all (keeps the default `list`
  // uncluttered after lots of one-shot CR / brainstorm sessions).
  const ephemeralHidden = opts.all
    ? 0
    : filtered.filter((s) => s.ephemeral).length;
  if (!opts.all) {
    filtered = filtered.filter((s) => !s.ephemeral);
  }

  // Sort by last activity desc; sessions without activity bubble to the bottom.
  filtered.sort((a, b) => {
    const ta = a.lastEventTs ?? "";
    const tb = b.lastEventTs ?? "";
    return tb.localeCompare(ta);
  });

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("(no Teamwork sessions match)");
    if (ephemeralHidden > 0) {
      console.log(
        `(${ephemeralHidden} ephemeral Teamwork session${ephemeralHidden === 1 ? "" : "s"} hidden — use --all to show)`,
      );
    }
    return;
  }

  printTable(filtered);
  if (ephemeralHidden > 0) {
    console.log(
      `\n(${ephemeralHidden} ephemeral Teamwork session${ephemeralHidden === 1 ? "" : "s"} hidden — use --all to show)`,
    );
  }
}

function summarize(
  name: string,
  project: string,
): TeamworkSessionSummary | null {
  const dir = sessionDir(name, project);
  const eventsFile = path.join(dir, "events.jsonl");
  if (!fs.existsSync(eventsFile)) return null;

  // Read events to find: createdAt + task, last event ts/kind, total
  // count. TeamworkSessions stay small (no auto-rotation; ~few MB at worst), so
  // a single full readFile per `list` invocation is fine.
  let firstEvent: CreateTeamworkEvent | null = null;
  let lastEvent: TeamworkEvent | null = null;
  let totalEvents = 0;
  const events: TeamworkEvent[] = [];

  try {
    const allText = fs.readFileSync(eventsFile, "utf-8");
    const lines = allText.split("\n").filter((l) => l.trim());
    totalEvents = lines.length;
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as TeamworkEvent);
      } catch {
        // skip corrupted lines
      }
    }
    if (events.length > 0) {
      const first = events[0];
      firstEvent = isCreateEvent(first) ? first : null;
      lastEvent = events[events.length - 1];
    }
  } catch {
    return null;
  }

  // Worker counts: scan *.pid files in dir, probe each pid.
  let workersAlive = 0;
  let workersTotal = 0;
  try {
    const entries = fs.readdirSync(dir);
    for (const e of entries) {
      if (!e.endsWith(".pid")) continue;
      workersTotal++;
      const pidFile = path.join(dir, e);
      const pid = Number(fs.readFileSync(pidFile, "utf-8").trim());
      if (pid && pidAlive(pid)) workersAlive++;
    }
  } catch {
    // ignore
  }

  // Use the full event-stream reducer so projected metadata reflects
  // title set/clear and context add/delete.
  const metadata = reduceTeamworkSessionMetadata(events);
  return {
    name,
    project,
    createdAt: firstEvent?.ts,
    task: firstEvent?.task,
    type: metadata.type,
    description: metadata.title ?? metadata.description,
    workersAlive,
    workersTotal,
    lastEventTs: lastEvent?.ts,
    lastEventKind: lastEvent?.kind,
    totalEvents,
    ephemeral: firstEvent?.ephemeral === true,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printTable(rows: TeamworkSessionSummary[]): void {
  const cols = [
    { key: "name", label: "NAME", width: 24 },
    { key: "workers", label: "TEAMMATES", width: 10 },
    { key: "events", label: "EVENTS", width: 7 },
    { key: "last", label: "LAST", width: 19 },
    { key: "kind", label: "KIND", width: 9 },
    { key: "type", label: "TYPE", width: 7 },
    { key: "task", label: "TASK", width: 0 }, // last column, no truncate
  ];

  // Header
  console.log(
    chalk.bold(
      cols.map((c) => (c.width ? c.label.padEnd(c.width) : c.label)).join("  "),
    ),
  );

  // Rows
  for (const r of rows) {
    const displayName = r.ephemeral ? `${r.name} *` : r.name;
    const name = trunc(displayName, cols[0].width);
    const workers =
      r.workersAlive > 0
        ? chalk.green(`${r.workersAlive}/${r.workersTotal}`)
        : r.workersTotal > 0
          ? chalk.gray(`0/${r.workersTotal}`)
          : chalk.gray("-");
    const events = String(r.totalEvents);
    const last = r.lastEventTs
      ? r.lastEventTs.slice(0, 19).replace("T", " ")
      : "-";
    const kind = colorKind(r.lastEventKind);
    const task = r.task ?? r.description ?? "-";

    console.log(
      [
        name.padEnd(cols[0].width),
        // Teammate count needs visible-width padding (chalk adds ANSI bytes).
        padVisible(workers, cols[1].width),
        events.padEnd(cols[2].width),
        last.padEnd(cols[3].width),
        padVisible(kind, cols[4].width),
        r.type.padEnd(cols[5].width),
        task,
      ].join("  "),
    );
  }
}

function trunc(s: string, w: number): string {
  if (s.length <= w) return s;
  return s.slice(0, w - 1) + "…";
}

/** Pad a string accounting for ANSI escape codes which take 0 visible width. */
function padVisible(s: string, w: number): string {
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, w - visible.length);
  return s + " ".repeat(pad);
}

function colorKind(k: string | undefined): string {
  if (!k) return chalk.gray("-");
  switch (k) {
    case "done":
      return chalk.green(k);
    case "error":
    case "killed":
      return chalk.red(k);
    case "spawned":
      return chalk.cyan(k);
    case "message":
      return chalk.yellow(k);
    case "progress":
      return chalk.gray(k);
    default:
      return k;
  }
}
