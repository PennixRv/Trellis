# Trellis on DeepSeek Harness (dsh)

dsh discovers project Skills and exposes a stable `DSH_SESSION_ID` to managed shells. The optional companion plugin supplies main-session breadcrumbs; Trellis does not install that plugin.

## Quick start

```bash
trellis init --dsh -u your-name
dsh web        # or: dsh --profile headless "start a Trellis task for ..."
```

In dsh:

1. Describe the work in natural language and load `trellis-start` when a
   session needs explicit Trellis bootstrap.
2. Follow the current task phase and authorized contract. Collaboration uses `trellis teamwork` or `paseo-based-parallelism`.
3. Use Delivery Review and On-Site Closeout Phase to review and close the task. `trellis-finish-work` records
   session progress separately and does not change task lifecycle state.

## Nested host sessions

DSH inherits ordinary environment variables from the process that launches it.
If that outer process is already an active Trellis session,
`TRELLIS_CONTEXT_ID` would otherwise override the inner `DSH_SESSION_ID`.
DSH rebuilds its complete `DSH_*` namespace for each managed shell, so the beta
adapter treats `DSH_SHELL=1` together with `DSH_SESSION_ID` as the current DSH
identity and resolves it before an inherited generic override, even without the
plugin. The optional plugin additionally contributes a trusted
`DSH_TRELLIS_CONTEXT_ID` when it must forward a child identity that differs
from the shell's own session id.

## File map

- `.agents/skills/` — shared workflow and bundled skills, byte-identical to
  the other Agent Skills writers.
- `.dsh/skills/trellis-{start,continue,finish-work}/` — DSH-private entry
  skills.
- `.dsh/DSH.md` — this operator guide.
- `.trellis/` — workflow, specs, tasks, workspace journal, and shared scripts.

## Notes

- Generated Python commands use `python3` in source templates and are rendered
  to the detected Windows launcher during `trellis init` / `trellis update`.
- Each `dsh --profile headless` invocation creates a fresh DSH session. Do not
  expect an active-task pointer to persist across separate headless calls; keep
  the workflow in one session or explicitly resume its returned session id.
- The optional companion plugin is maintained separately at
  <https://github.com/SajoLuo/dsh-trellis>.
