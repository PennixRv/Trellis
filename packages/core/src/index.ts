// Root barrel — re-exports the Teamwork and task public APIs so callers
// can `import { ... } from "@mindfoldhq/trellis-core"`. Sub-path
// imports (`@mindfoldhq/trellis-core/teamwork`, `/task`) remain the
// recommended form for tree-shake-friendly consumption.

export * from "./teamwork/index.js";
export * from "./task/index.js";
