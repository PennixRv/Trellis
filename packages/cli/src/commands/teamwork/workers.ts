import {
  parseTeamworkSessionScope,
  readTeamworkEvents,
  reduceCoordinationState,
  reduceWorkerRegistry,
} from "@pennixrv/trellis-core/teamwork";

/** Public telemetry view; Core reducers retain lifecycle and coordination ownership. */
export async function teamworkWorkers(
  name: string,
  opts: {
    scope?: string;
    projectKey?: string;
    includeTerminal?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const events = await readTeamworkEvents({
    sessionId: name,
    scope: parseTeamworkSessionScope(opts.scope),
    ...(opts.projectKey ? { projectKey: opts.projectKey } : {}),
  });
  const bindings = (worker: string, batchId?: string): string[] => [
    ...new Set(
      events
        .filter(
          (e) =>
            e.kind === "session_bound" &&
            e.worker === worker &&
            e.batchId === batchId,
        )
        .map((e) => e.sessionId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const workers = reduceWorkerRegistry(events).workers.map((w) => ({
    workerId: w.workerId,
    provider: w.provider,
    lifecycle: w.lifecycle,
    activity: w.activity,
    terminal: w.terminal,
    updatedAt: w.updatedAt,
    sessionIds: bindings(w.workerId),
  }));
  const coordination = reduceCoordinationState(events);
  if (coordination.issues.length)
    throw new Error("Invalid Teamwork coordination projection");
  for (const teammate of coordination.teammates) {
    const assigned = events.find(
      (e) =>
        e.kind === "coordination" &&
        e.entity === "teammate" &&
        e.batchId === teammate.batchId &&
        e.teammateId === teammate.teammateId &&
        e.state === "ASSIGNED",
    );
    const provider = (assigned?.payload as Record<string, unknown> | undefined)
      ?.provider;
    if (typeof provider !== "string")
      throw new Error("Teamwork teammate provider is unknown");
    const failed = ["FAILED", "FINAL_FAILED"].includes(teammate.state);
    const done = teammate.state === "REPORT_SUBMITTED";
    const waiting = ["TIMEOUT_YIELDED", "WAITING_FOR_MAIN_COMMAND"].includes(
      teammate.state,
    );
    workers.push({
      workerId: `${teammate.batchId}:${teammate.teammateId}`,
      provider,
      lifecycle: failed
        ? "error"
        : done
          ? "done"
          : teammate.state === "ASSIGNED"
            ? "starting"
            : "running",
      activity: waiting || done || failed ? "idle" : "mid-turn",
      terminal: failed || done,
      updatedAt: events.find((e) => e.seq === teammate.lastSeq)?.ts ?? "",
      sessionIds: bindings(teammate.teammateId, teammate.batchId),
    });
  }
  const visible = opts.includeTerminal
    ? workers
    : workers.filter((w) => !w.terminal);
  console.log(
    opts.json
      ? JSON.stringify(visible)
      : visible
          .map((w) => `${w.workerId}\t${w.lifecycle}\t${w.activity}`)
          .join("\n"),
  );
}
