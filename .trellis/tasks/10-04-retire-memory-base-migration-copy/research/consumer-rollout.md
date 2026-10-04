# Beta30 consumer rollout

Scope is the same seven project roots approved by the removal task. Root and FastCtx retain custom `codex-subnode-channel` at Marketplace SHA `01aeef87a504bfaf6f9242887bf1e9a60294035f`; five other roots retain native.

The beta30 preflight reported no asset changes for the two custom consumers. Five native consumers refused dry-run only because their provenance ref was beta29. Native `workflow --template native --create-new` generated candidates; full byte comparison proved every one identical to the active file. Accept provenance-only refresh for these exact roots: `/home/penn/devel/Trellis`, root-nested `Trellis`, Pennix Skills, CCH, and Windsurf. After native apply + verify, remove only these five exact byte-identical `.trellis/workflow.md.new` sidecars.

Use native `trellis update --skip-all` to preserve every modified file; only safe generated assets/version receipts may update. No migration flag or force overwrite is approved. Protected project state, CCH/Windsurf providers/hooks/agents, and existing unrelated dirty files remain intact.
