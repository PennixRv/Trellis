import {
  parseDeliveryMode,
  sendMessage as coreSendMessage,
  type TeamworkSessionScope,
} from "@mindfoldhq/trellis-core/teamwork";

import { parseTeamworkSessionScope, parseCsv } from "./store/schema.js";
import { resolveTeamworkSessionTextBody } from "./text-body.js";

export interface SendOptions {
  as: string;
  text?: string;
  stdin?: boolean;
  textFile?: string;
  scope?: string;
  to?: string; // CSV
  deliveryMode?: string;
}

export async function teamworkSessionSend(
  sessionId: string,
  opts: SendOptions,
): Promise<void> {
  const text = await resolveTeamworkSessionTextBody(opts, {
    required: true,
    missingMessage:
      "No text provided (use <text> arg, --stdin, or --text-file)",
    emptyMessage: "Empty message",
  });
  const to = parseCsv(opts.to);
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const deliveryMode = parseDeliveryMode(opts.deliveryMode);

  const event = await coreSendMessage({
    sessionId: sessionId,
    by: opts.as,
    text: text as string,
    ...(scope !== undefined ? { scope } : {}),
    ...(to !== undefined ? { to: to.length === 1 ? to[0] : to } : {}),
    ...(deliveryMode !== undefined ? { deliveryMode } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}
