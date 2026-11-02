// Root barrel — re-exports the Teamwork and task public APIs so callers
// can `import { ... } from "@pennixrv/trellis-core"`. Sub-path
// imports (`@pennixrv/trellis-core/teamwork`, `/task`) remain the
// recommended form for tree-shake-friendly consumption.

export * from "./teamwork/index.js";
export * from "./task/index.js";
