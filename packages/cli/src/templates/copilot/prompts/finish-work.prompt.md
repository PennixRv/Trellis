---
description: "Record progress in the Trellis developer session journal."
---

# Finish Work

Record progress in the developer session journal when ending this session. This prompt does not change task status, phase state, or implementation authorization. Task completion and cancellation are handled in phase 5 through Trellis CLI.

## Review the current session

    python3 ./.trellis/scripts/get_context.py --mode record

Review the current task, repository changes, and recent commits. Make the journal summary clear about completed work, remaining work, and blockers. A clean working tree or committed changes do not by themselves mean the task is complete.

## Record the journal

    python3 ./.trellis/scripts/add_session.py \
      --title "Session title" \
      --commit "hash1,hash2" \
      --summary "Progress, remaining work, and blockers"

Pass only commit hashes that belong to this session. Omit --commit when no relevant commit exists. Leave task state to Trellis CLI and formal session handoff to its separate, explicitly requested workflow.
