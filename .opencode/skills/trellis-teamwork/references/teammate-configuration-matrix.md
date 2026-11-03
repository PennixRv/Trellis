# Teammate configuration matrix

The candidate source for teammate execution settings is the teammate
configuration matrix. It is a selection input, not a new role system. A
profile may provide a default provider and model plus provider-specific
options. The frozen plan stores the selected execution values in the
`Teammate Execution Configuration` snapshot so a running batch is unaffected
by later matrix changes.

The tuple is:

```text
role + provider + optional profile + model + reasoning effort + options
```

The role remains `teammate`. Coordination mode is separate from role and
profile. Supported provider adapters are Codex app-server, DSH ACP, Copilot
ACP, and Claude Code CLI when their host contracts are available. A provider
name alone does not prove that its host is installed or verified.

The host capability proof covers only the boundaries required by the selected
plan: foreground waiting, protected artifact writes, read-only protected
targets and Git state, disabled native or recursive delegation, isolated
context, supported transport, and a positive capacity. The CLI refuses a
dispatch when the selected host cannot prove those properties. It does not
invent an execution profile or silently change the frozen values.

The bundled role card is `.trellis/agents/teammate.md`. It is provider-neutral
and limits a teammate to the frozen context and current attempt artifacts. A
Teamwork teammate is not the native host-created `subagent`; the two have
different creation paths and contracts.
