import {
  requestInterrupt,
  type TeamworkSessionScope,
} from "@pennixrv/trellis-core/teamwork";

import { parseTeamworkSessionScope } from "./store/schema.js";
import { resolveTeamworkSessionTextBody } from "./text-body.js";

export interface InterruptOptions {
  as: string;
  to: string;
  text?: string;
  stdin?: boolean;
  textFile?: string;
  scope?: string;
}

export async function teamworkSessionInterrupt(
  sessionId: string,
  opts: InterruptOptions,
): Promise<void> {
  const message = await resolveTeamworkSessionTextBody(opts, {
    required: true,
    missingMessage:
      "No interrupt message provided (use <text> arg, --stdin, or --text-file)",
    emptyMessage: "Empty interrupt message",
  });
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );

  const event = await requestInterrupt({
    sessionId: sessionId,
    by: opts.as,
    workerId: opts.to,
    message,
    reason: "user",
    ...(scope !== undefined ? { scope } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}
