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

The coordinator's host capability proof covers foreground waiting, protected
artifact writes, attempt artifact output, disabled native delegation, isolated
context, supported transport, and a positive capacity. Source and Git write
boundaries are role obligations recorded in `writePolicy`; they do not require
filesystem or Git permission isolation. Available tools do not authorize a
teammate to implement product code. The coordinator rejects an incomplete
runtime proof without silently changing the frozen execution values.

The public `trellis teamwork batch` entry currently refuses dispatch before
coordination state is written. It does not discover or connect a host adapter;
interactive `spawn` and `run` do not establish a verified batch adapter.

The bundled role card is `.trellis/agents/teammate.md`. It is provider-neutral
and limits a teammate to the frozen context and current attempt artifacts. A
Teamwork teammate is not the native host-created `subagent`; the two have
different creation paths and contracts.
