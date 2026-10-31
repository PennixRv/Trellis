import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

import { eventsPath, sessionDir } from "./paths.js";
import type { TeamworkEvent } from "./events.js";
import { matchesEventFilter, type TeamworkEventFilter } from "./filter.js";

export type WatchFilter = TeamworkEventFilter;

interface ReadProgress {
  byteOffset: number;
  carry: string;
  decoder: StringDecoder;
}

async function readNewEvents(
  filePath: string,
  state: ReadProgress,
): Promise<TeamworkEvent[]> {
  if (!fs.existsSync(filePath)) {
    // File was deleted (e.g. `--force` recreate) — reset offset so when
    // the file reappears we'll re-scan it from byte 0.
    state.byteOffset = 0;
    state.carry = "";
    state.decoder = new StringDecoder("utf8");
    return [];
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size < state.byteOffset) {
    // File was truncated / rotated / replaced — re-scan from start so
    // post-truncate events aren't lost forever.
    state.byteOffset = 0;
    state.carry = "";
    state.decoder = new StringDecoder("utf8");
  }
  if (stat.size <= state.byteOffset) return [];

  const fh = await fs.promises.open(filePath, "r");
  try {
    const length = stat.size - state.byteOffset;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, state.byteOffset);
    state.byteOffset = stat.size;
    const text = state.carry + state.decoder.write(buf);
    const lines = text.split("\n");
    state.carry = lines.pop() ?? "";
    const events: TeamworkEvent[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        events.push(JSON.parse(t) as TeamworkEvent);
      } catch {
        // corrupted line — skip
        continue;
      }
    }
    return events;
  } finally {
    await fh.close();
  }
}

/**
 * Watch the Teamwork Session events.jsonl file for matching events.
 *
 * Yields each matching event as it arrives. Caller may break to stop;
 * the function cleans up on iterator return.
 *
 * Implementation: fs.watch with a 200ms safety poll for platforms where
 * fs.watch is lossy (Windows, NFS, etc.).
 */
export async function* watchEvents(
  sessionId: string,
  filter: WatchFilter,
  opts: {
    signal?: AbortSignal;
    fromStart?: boolean;
    sinceSeq?: number;
    project?: string;
  } = {},
): AsyncGenerator<TeamworkEvent, void, unknown> {
  const file = eventsPath(sessionId, opts.project);
  // Ensure the Teamwork Session directory exists so fs.watch works.
  if (!fs.existsSync(sessionDir(sessionId, opts.project))) {
    await fs.promises.mkdir(sessionDir(sessionId, opts.project), {
      recursive: true,
    });
  }

  // Three modes:
  //   default (from-now): start at EOF. Used by `wait` so a previous
  //     turn's `done` doesn't unblock a fresh wait immediately.
  //   fromStart=true: start at offset 0 and yield existing events
  //     before tailing. Used by first-time supervisor inbox catch-up.
  //   sinceSeq=N: like fromStart=true but skip events with seq <= N.
  //     Used by supervisor inbox watcher after the first run so a
  //     respawn doesn't replay already-processed messages.
  let initialOffset = 0;
  if (!opts.fromStart && opts.sinceSeq === undefined) {
    try {
      if (fs.existsSync(file)) {
        initialOffset = (await fs.promises.stat(file)).size;
      }
    } catch {
      initialOffset = 0;
    }
  }
  const state: ReadProgress = {
    byteOffset: initialOffset,
    carry: "",
    decoder: new StringDecoder("utf8"),
  };
  const sinceSeq = opts.sinceSeq;

  let resolveNext: (() => void) | null = null;

  const wake = (): void => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(sessionDir(sessionId, opts.project), () => wake());
    watcher.on("error", () => {
      try {
        watcher?.close();
      } catch {
        // already closed
      }
      watcher = null;
      // Keep the generator alive; the 200ms poll remains the fallback.
      wake();
    });
  } catch {
    // ignore — fall back to polling
  }

  // 200ms safety polling (Windows / NFS / macOS fs.watch quirks)
  const poll = setInterval(wake, 200);

  const abortHandler = (): void => wake();
  opts.signal?.addEventListener("abort", abortHandler);

  try {
    while (true) {
      if (opts.signal?.aborted) return;

      const fresh = await readNewEvents(file, state);
      for (const ev of fresh) {
        if (sinceSeq !== undefined && ev.seq <= sinceSeq) continue;
        if (matchesEventFilter(ev, filter)) yield ev;
        if (opts.signal?.aborted) return;
      }

      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    clearInterval(poll);
    try {
      watcher?.close();
    } catch {
      // already closed
    }
    opts.signal?.removeEventListener("abort", abortHandler);
  }
}
