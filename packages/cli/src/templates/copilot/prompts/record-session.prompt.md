---
description: "Trellis Copilot prompt: Method 1: Simple parameters"
---

[!] **Prerequisite**: Record verified progress and the actual commit references for this session. Do not imply that the task is complete merely because work was committed.

Task status and phase state are changed only through Trellis CLI. This prompt records the developer session journal; it does not archive, complete, or cancel tasks.

---

## Record Work Progress

### Step 1: Get Context

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

Review the current phase, changed files, recent commits, remaining work, and blockers. Use the Delivery Review and On-Site Closeout Phase Skill with the Trellis CLI to complete or cancel a task when its acceptance conditions are met.

### Step 2: One-Click Add Session

```bash
# Method 1: Simple parameters
python3 ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary of what was done"

# Method 2: Pass detailed content via stdin
cat << 'EOF' | python3 ./.trellis/scripts/add_session.py --stdin --title "Title" --commit "hash"
| Feature | Description |
|---------|-------------|
| New API | Added user authentication endpoint |
| Frontend | Updated login form |

**Updated Files**:
- `packages/api/modules/auth/router.ts`
- `apps/web/modules/auth/components/login-form.tsx`
EOF
```

**Auto-completes**:
- [OK] Appends session to journal-N.md
- [OK] Auto-detects line count, creates new file if >2000 lines
- [OK] Auto-detects Branch context (`--branch` override; otherwise Branch = task.json -> current git branch; missing values are omitted gracefully)
- [OK] Updates index.md (Total Sessions +1, Last Active, line stats, history)
- [OK] Auto-commits .trellis/workspace and .trellis/tasks changes

---

## Script Command Reference

| Command | Purpose |
|---------|---------|
| `python3 ./.trellis/scripts/get_context.py --mode record` | Get context for record-session |
| `python3 ./.trellis/scripts/add_session.py --title "..." --commit "..."` | **One-click add session (recommended, branch auto-complete)** |
| `python3 ./.trellis/scripts/task.py list` | List active tasks |
