import {
  listWorkers,
  parseChannelScope,
  type WorkerState,
} from "@pennixrv/trellis-core/channel";

export interface WorkersOptions {
  scope?: string;
  projectKey?: string;
  includeTerminal?: boolean;
  json?: boolean;
}

/** Show the core's durable worker projection; never infer state from PIDs. */
export async function channelWorkers(
  channelName: string,
  opts: WorkersOptions = {},
): Promise<void> {
  const workers = await listWorkers({
    channel: channelName,
    scope: parseChannelScope(opts.scope),
    ...(opts.projectKey ? { projectKey: opts.projectKey } : {}),
    includeTerminal: opts.includeTerminal,
  });
  if (opts.json) {
    console.log(JSON.stringify(workers, null, 2));
    return;
  }
  if (workers.length === 0) {
    console.log("No workers found.");
    return;
  }
  console.log("WORKER\tLIFECYCLE\tACTIVITY\tPENDING\tLAST_SEQ");
  for (const worker of workers) printWorker(worker);
}

function printWorker(worker: WorkerState): void {
  console.log(
    [
      worker.workerId,
      worker.lifecycle,
      worker.activity,
      worker.pendingMessageCount,
      worker.lastSeq,
    ].join("\t"),
  );
}
