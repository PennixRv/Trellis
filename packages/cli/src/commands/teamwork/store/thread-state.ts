export {
  reduceThreads,
  buildThreadAliasResolver,
  collectThreadTimeline,
} from "@mindfoldhq/trellis-core/teamwork";

export type {
  ThreadState,
  ThreadAliasResolver,
} from "@mindfoldhq/trellis-core/teamwork";

import type { ThreadState } from "@mindfoldhq/trellis-core/teamwork";

export function formatThreadBoard(states: ThreadState[]): string[] {
  if (states.length === 0) return ["(no threads)"];
  return [
    "THREAD  STATUS  TITLE",
    ...states.map((state) => {
      const labels =
        state.labels.length > 0 ? ` labels=${state.labels.join(",")}` : "";
      const assignees =
        state.assignees.length > 0
          ? ` assignees=${state.assignees.join(",")}`
          : "";
      return `${state.thread} [${state.status}] ${state.title ?? ""}${labels}${assignees}`;
    }),
  ];
}
