import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

import type { TeamworkEvent } from "./events.js";
import { matchesEventFilter, type TeamworkEventFilter } from "./filter.js";
import { sessionDir, eventsPath } from "./paths.js";

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
    state.byteOffset = 0;
    state.carry = "";
    state.decoder = new StringDecoder("utf8");
    return [];
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size < state.byteOffset) {
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
        continue;
      }
    }
    return events;
  } finally {
    await fh.close();
  }
}

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
  if (!fs.existsSync(sessionDir(sessionId, opts.project))) {
    await fs.promises.mkdir(sessionDir(sessionId, opts.project), {
      recursive: true,
    });
  }

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
