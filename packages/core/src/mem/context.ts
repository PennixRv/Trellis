/**
 * Dialogue-window context extraction: resolve a session, optionally merge
 * sub-agent children, then select a token-budgeted window of turns around the
 * top hits.
 */

import { visitCodexDialogue } from "./adapters/codex.js";
import {
  buildChildIndex,
  extractDialogue,
  findSessionById,
  listAll,
  MemSessionNotFoundError,
  resolveFilter,
  WIDE_LIMIT,
} from "./sessions.js";
import type {
  DialogueRole,
  DialogueTurn,
  MemContextResult,
  MemContextTurn,
  MemSessionInfo,
  MemWarning,
  ReadMemContextOptions,
} from "./types.js";

interface SelectedContext {
  turns: MemContextTurn[];
  totalHitTurns: number;
  budgetUsed: number;
}

interface ContextMetadata {
  idx: number;
  role: DialogueRole;
  hits: number;
  length: number;
}

function contextMatchCount(text: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  if (!tokens.every((tok) => hay.includes(tok))) return 0;
  let hits = 0;
  for (const tok of tokens) {
    let from = 0;
    while (true) {
      const idx = hay.indexOf(tok, from);
      if (idx === -1) break;
      hits++;
      from = idx + tok.length;
    }
  }
  return hits;
}

function contextIndices(
  metadata: readonly ContextMetadata[],
  grep: string | undefined,
  nTurns: number,
  around: number,
): { ordered: number[]; hitSet: Set<number>; totalHitTurns: number } {
  const ranked = grep ? metadata.filter((turn) => turn.hits > 0) : [];
  ranked.sort((a, b) => {
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    return b.hits - a.hits || a.idx - b.idx;
  });
  const hitIndices = (grep ? ranked : metadata)
    .slice(0, Math.max(0, nTurns))
    .map((turn) => turn.idx);
  const display = new Set<number>();
  for (const idx of hitIndices) {
    for (
      let j = Math.max(0, idx - around);
      j <= Math.min(metadata.length - 1, idx + around);
      j++
    ) display.add(j);
  }
  return {
    ordered: [...display].sort((a, b) => a - b),
    hitSet: new Set(hitIndices),
    totalHitTurns: ranked.length,
  };
}

/** Include truncation notation in the budget; tiny budgets keep text only. */
function contextTextPlan(length: number, maxChars: number): {
  take: number;
  suffix: string;
} {
  if (maxChars <= 0) return { take: 0, suffix: "" };
  let take = Math.floor(maxChars / 2);
  if (length <= take) return { take: length, suffix: "" };
  let suffix = `\n…[+${length - take} chars]`;
  if (suffix.length > maxChars) return { take: Math.min(length, maxChars), suffix: "" };
  while (take + suffix.length > maxChars) {
    take = Math.max(0, maxChars - suffix.length);
    suffix = `\n…[+${length - take} chars]`;
    if (suffix.length > maxChars) return { take: Math.min(length, maxChars), suffix: "" };
  }
  return { take, suffix };
}

/**
 * Pure selection: rank turns against `grep` (user-role first, then hit
 * density), take the top `nTurns`, expand each by `around` turns of context,
 * then emit turns within `maxChars` — head-truncating any single turn that
 * exceeds half the budget. With no `grep`, returns the first `nTurns` turns.
 */
export function selectContextTurns(
  turns: readonly DialogueTurn[],
  grep: string | undefined,
  nTurns: number,
  around: number,
  maxChars: number,
): SelectedContext {
  const tokens = grep?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const metadata = turns.map((turn, idx) => ({
    idx, role: turn.role, hits: contextMatchCount(turn.text, tokens), length: turn.text.length,
  }));
  const { ordered, hitSet, totalHitTurns } = contextIndices(metadata, grep, nTurns, around);
  const out: MemContextTurn[] = [];
  let used = 0;
  for (const i of ordered) {
    const t = turns[i];
    if (!t) continue;
    const plan = contextTextPlan(t.text.length, maxChars);
    const text = t.text.slice(0, plan.take) + plan.suffix;
    if (!text || used + text.length > maxChars) break;
    out.push({ idx: i, role: t.role, text, isHit: hitSet.has(i) });
    used += text.length;
  }

  return { turns: out, totalHitTurns, budgetUsed: used };
}

function readCodexContext(
  s: MemSessionInfo,
  grep: string | undefined,
  nTurns: number,
  around: number,
  maxChars: number,
  warnings: MemWarning[],
): SelectedContext & { totalTurns: number } {
  const tokens = grep?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const metadata: ContextMetadata[] = [];
  const { totalTurns, prefixLength } = visitCodexDialogue(s, (turn, idx) => {
    metadata.push({ idx, role: turn.role, hits: contextMatchCount(turn.text, tokens), length: turn.text.length });
  }, warnings);
  metadata.sort((a, b) => a.idx - b.idx);
  for (const turn of metadata) turn.idx += prefixLength;
  const { ordered, hitSet, totalHitTurns } = contextIndices(metadata, grep, nTurns, around);
  const chosen = new Map<number, { idx: number; take: number; suffix: string }>();
  let budgetUsed = 0;
  for (const idx of ordered) {
    const turn = metadata[idx];
    if (!turn) continue;
    const plan = contextTextPlan(turn.length, maxChars);
    const length = plan.take + plan.suffix.length;
    if (!length || budgetUsed + length > maxChars) break;
    chosen.set(idx - prefixLength, { idx, ...plan });
    budgetUsed += length;
  }
  const selected = new Map<number, MemContextTurn>();
  if (chosen.size > 0) visitCodexDialogue(s, (turn, rawIndex) => {
    const plan = chosen.get(rawIndex);
    if (!plan) return;
    selected.set(plan.idx, {
      idx: plan.idx, role: turn.role,
      text: turn.text.slice(0, plan.take) + plan.suffix,
      isHit: hitSet.has(plan.idx),
    });
  });
  const turns = [...selected.values()].sort((a, b) => a.idx - b.idx);
  return { turns, totalTurns, totalHitTurns, budgetUsed: turns.reduce((n, turn) => n + turn.text.length, 0) };
}

/** Drill into a single session: top-N hit turns plus surrounding context,
 * char-budgeted. With no `grep`, returns the session opening. */
export function readMemContext(
  options: ReadMemContextOptions,
): MemContextResult {
  const f = resolveFilter(options.filter);
  const warnings: MemWarning[] = [];
  const s = findSessionById(options.sessionId, f, warnings);
  if (!s) throw new MemSessionNotFoundError(options.sessionId, warnings);

  const grep = typeof options.grep === "string" ? options.grep : undefined;
  const nTurns = options.turns ?? 3;
  const around = options.around ?? 1;
  const maxChars = options.maxChars ?? 6000;

  let kids: MemSessionInfo[] = [];
  if (options.includeChildren === true) {
    const all = listAll({ ...f, cwd: undefined, limit: WIDE_LIMIT }, warnings);
    const childIndex = buildChildIndex(all);
    kids = childIndex.get(s.id) ?? [];
  }
  if (s.platform === "codex" && kids.length === 0) {
    const selected = readCodexContext(s, grep, nTurns, around, maxChars, warnings);
    return { session: s, query: grep, mergedChildren: 0, maxChars, warnings, ...selected };
  }

  let turns: DialogueTurn[] = extractDialogue(s, warnings);
  for (const c of kids) turns = [...turns, ...extractDialogue(c, warnings)];
  const selected = selectContextTurns(turns, grep, nTurns, around, maxChars);

  return {
    session: s,
    query: grep,
    totalTurns: turns.length,
    totalHitTurns: selected.totalHitTurns,
    mergedChildren: kids.length,
    budgetUsed: selected.budgetUsed,
    maxChars,
    turns: selected.turns,
    warnings,
  };
}
