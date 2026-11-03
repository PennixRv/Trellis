# Filesystem Safety — Atomic Writes & Destructive-Op Guards

> Cross-cutting contract for any code that **writes, deletes, moves, or
> overwrites** files in a user's repo. Trellis ships as a CLI that runs inside
> real git repos, so a truncated write or a mistargeted delete is user data
> loss, not a transient bug. These are the guardrails the 2026-07-10 audit's
> two root causes distilled to.

Applies to: `commands/update.ts`, `commands/uninstall.ts`, `utils/*`,
`core/teamwork/**`, and the shipped Python under `templates/trellis/scripts/`.

---

## 1. Atomic writes — never truncate a state file in place

**Rule**: a file that holds durable state (attribution manifest, `task.json`,
`config.yaml`, session pointer, Teamwork event sequence sidecar) must be written
**temp-in-same-dir + rename**, never `fs.writeFileSync(path, ...)` /
`path.write_text(...)` directly. In-place writes truncate the target as their
first step, so a crash / Ctrl-C / ENOSPC mid-write leaves a half-file. A
truncated `.template-hashes.json` heals to `{}` (every managed file then looks
user-modified); a truncated `task.json` reads back as `None` (the task vanishes
from `task.py list`).

### Signatures

```ts
// packages/cli/src/utils/atomic-write.ts
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): void;
// writes `<dir>/.<basename>.<pid>.tmp` then fs.renameSync over filePath;
// removes the tmp and rethrows on failure. Same-dir tmp keeps rename atomic.
```

```python
# templates/trellis/scripts/common/io.py
def write_json(path: Path, data: dict) -> bool
def write_text_atomic(path: Path, text: str) -> bool
# tempfile.mkstemp(dir=path.parent) -> os.fdopen write -> os.replace(tmp, path);
# unlinks tmp and re-raises on BaseException (Ctrl-C included).
# write_json serializes and delegates, so both share one implementation.
```

`write_text_atomic` covers the Markdown state files, not just JSON:
`add_session.py` appends to `journal-*.md` and rewrites `index.md` through it.
Those two carry the session record that a retry classifies, so a half-written
one is not a cosmetic defect — it is pending evidence nothing can resume from.
The append is read-all + write-all rather than `open("a")` for exactly that
reason.

### Wrong vs Correct

```ts
// Wrong — truncates on entry; a crash here corrupts the manifest to {}
fs.writeFileSync(hashesPath, JSON.stringify(payload, null, 2));

// Correct
writeFileAtomic(hashesPath, JSON.stringify(payload, null, 2));
```

> **Note**: atomic write fixes the _crash window_. It does **not** fix
> concurrent last-writer-wins (multiple processes RMW the same file). File
> locking / seq reconciliation is a separate, still-open concern.

---

## 2. Path & name safety — validate at the chokepoint, before `path.join`

**Rule**: any user- or agent-supplied string that becomes a path segment must be
validated **before** it flows into `path.join` / `shutil.move` / `rmSync`. A
name like `../../x` resolves outside the intended tree and a later recursive
delete escapes the store.

| Concern | Guard | Location |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Teamwork Session / teammate name | `assertSafeName(name, kind)` — `^[A-Za-z0-9._-]+$`, rejects `.`/`..` — called inside `sessionDir` (the shared chokepoint every session path helper passes through) | `core/teamwork/internal/store/paths.ts` and `cli/commands/teamwork/store/paths.ts` |
| Task command / relocation target | 仅允许四种状态目录的确切层级；拒绝越界、后代符号链接与冲突，恢复前核对全部输入 | `scripts/common/task_layout.py`, `task_utils.py`, `task_move.py` |
| rename-dir migration source | `dirHasManifestEntries(fromDir, hashes)` — only auto-move a dir Trellis provably created | `commands/update.ts` |

> **Why the chokepoint, not the entrypoint**: validating inside `sessionDir`
> (not in each of create/rm/run) means one guard covers every current and future
> caller. `spawn.ts` had long _asserted_ this — a "CLI layer already validates
> names" comment — while no such validation existed; adding the guard at the
> `sessionDir` chokepoint is what finally made that comment true.

```ts
// Correct: guard lives in the shared path builder
export function sessionDir(
  name: string,
  project = currentProjectKey(),
): string {
  assertSafeName(name);
  return path.join(projectDir(project), name);
}
```

---

## 3. Destructive-op ownership / backup gate

Before deleting, moving, or overwriting anything that **could be user data**,
one of these must hold. Pick by operation:

| Operation | Required guard |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delete a mixed-ownership file (e.g. `AGENTS.md`) | Strip only the managed block (`scrubManagedMarkdownBlock`); delete only if nothing user-authored remains. Never `unlinkSync` the whole file. |
| Move a dir that may be user-owned (rename-dir) | Ownership check (`dirHasManifestEntries`); unowned + target-absent → **skip** (safe even under `--force`, since skip never executes). |
| Overwrite a dir from a remote source | Download to a temp dir; `rm` + copy the old dir **only after** the download succeeds (`downloadWithStrategy` `overwrite`). Never delete-then-download. |
| Rename onto a possibly-existing target | `fs.existsSync(newPath)` first; skip/renumber instead of clobbering (`renameTracesToJournal`). Especially when the dir is excluded from backup. |
| `rm -rf` a tree with user data (`uninstall`) | `collectUncommittedTrellisData(cwd)` (git status over `spec/tasks/workspace`); scripted `--yes` fails closed unless `TRELLIS_ALLOW_DIRTY_UNINSTALL=1`. Disclosure must name what user data is deleted. |

**Env override precedent**: a fail-closed guard on a `--yes`/`--force` path gets
an explicit env bypass, mirroring `TRELLIS_ALLOW_HOMEDIR`
(`TRELLIS_ALLOW_DIRTY_UNINSTALL=1`). Warn-and-continue is not enough on
`--yes` — nobody reads scrollback in a script.

---

## 4. Dogfood twin sync

Shipped Python (`packages/cli/src/templates/trellis/scripts/**`) has a dogfood
twin at repo `.trellis/scripts/**`. **Every `.py` under the two trees must be
byte-identical, and the build fails if it is not** — there is no such thing as
acceptable local drift. Edit both copies, never one.

The full contract, including what the test does and does not cover, is in
`script-conventions.md` → "Two script trees, one content". `packages/cli/dist/**`
and `.trellis/.backup-*/**` are generated/history — never hand-edit.

---

## 5. Tests required

Every guard here leaves a runnable regression test whose assertion **fails
without the guard**:

- Atomic write: write-succeeds + no tmp leftover + original survives a failed write (`test/utils/atomic-write.test.ts`; Python covered via `task-archive` integration).
  - Path traversal: `teamwork create '../../victim' --force` / `teamwork rm '../../victim'` throw and the external dir survives — reproduce in a sandbox (`test/teamwork/name-safety`, `test/commands/teamwork-name-safety`).
- Ownership/backup gates: unowned source skipped (`update-internals` rename-dir gate), `archive src` refused with `src/` intact (`task-archive` integration), overwrite-fails-preserves-spec (`template-fetcher-overwrite`), uninstall refuses dirty `--yes` (`uninstall-dirty-guard`, real git).
- Dogfood twin sync: identical `.py` path sets in both trees, plus one byte-compare case per file (`regression.test.ts` → "regression: .trellis/scripts stays byte-identical to templates/trellis/scripts"). The file list is derived from the filesystem, so a new script is covered the moment it is added.

---

## Related

- [`trellis update` Command](./commands-update.md) — migration classification/apply
- [`trellis uninstall` Command](./commands-uninstall.md) — plan/execute phases
- [`trellis teamwork` Command](./commands-teamwork.md) — store paths, project buckets
- [Script Conventions](./script-conventions.md) — Python `io.py` contract
- [Migrations](./migrations.md) — rename/rename-dir/delete semantics

## Teamwork Context Trust Set (`teamwork.trusted_context_dirs`, #414)

Teammate context containment (context-loader `jailedRealpath`, agent-loader,
OMP extension `resolveProjectFile`) accepts realpaths inside the teammate cwd **or**
inside a trusted root. Trusted roots resolve once per spawn
(`teamwork/context-trust.ts` `resolveTrustedRoots(cwd)`):

1. `.trellis/config.yaml` → `teamwork.trusted_context_dirs` (list; relative
   entries resolve against cwd; missing dirs warn + skip; each entry is
   realpath-canonicalized).
2. Auto-trust (disable with `teamwork.auto_trust_trellis_symlinks: false`):
   ONLY the top-level `.trellis/tasks` and `.trellis/workspace` entries, when
   they are themselves symlinks, contribute their realpath targets. No
   recursion — a nested symlink planted inside a task dir stays refused.

Containment predicate (identical at all three sites, byte-comparable):
`real === root || real.startsWith(root + path.sep)` — the `path.sep` suffix is
load-bearing (blocks `/work/ws-evil` matching trusted `/work/ws`). The OMP
template carries a standalone verbatim copy of the parser/resolver; changes
must be mirrored there. Do not relax to lexical checks — realpath containment
is the defense from the 2026-07-10 audit (#409 family).
