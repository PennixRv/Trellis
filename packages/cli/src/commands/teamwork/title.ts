import {
  clearTeamworkSessionTitle,
  setTeamworkSessionTitle,
  type TeamworkSessionScope,
} from "@pennixrv/trellis-core/teamwork";

import { parseTeamworkSessionScope } from "./store/schema.js";

export interface TitleSetCliOptions {
  as?: string;
  title: string;
  scope?: string;
}

export interface TitleClearCliOptions {
  as?: string;
  scope?: string;
}

export async function teamworkSessionTitleSet(
  sessionId: string,
  opts: TitleSetCliOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const event = await setTeamworkSessionTitle({
    sessionId: sessionId,
    by: opts.as ?? "main",
    title: opts.title,
    ...(scope !== undefined ? { scope } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}

export async function teamworkSessionTitleClear(
  sessionId: string,
  opts: TitleClearCliOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const event = await clearTeamworkSessionTitle({
    sessionId: sessionId,
    by: opts.as ?? "main",
    ...(scope !== undefined ? { scope } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}
