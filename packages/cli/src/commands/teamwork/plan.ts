import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { computeTeamworkPlanHash, validateTeamworkPlan } from "./artifact.js";
import {
  readCoordinationState,
  readTeamworkEvents,
} from "@pennixrv/trellis-core/teamwork";
import {
  resolveCoordination,
  assertCoordinationMembers,
  COORDINATION_MODES,
} from "./coordination.js";
import { resolveTeammateProfile, REASONING_EFFORTS } from "./profiles.js";
import {
  buildTeammateLaunchSpec,
  assertTeammateContextCurrent,
} from "./teammate-launch.js";
import type { TeammateHostCapabilities } from "./teammate-adapters.js";
import {
  assertTeamworkPlanCurrent,
  assertTeamworkReceiptDurable,
  readPlanFile,
} from "./coordinator.js";
import { assertFrozenCoordination } from "./coordination.js";
import { writeFileAtomic } from "../../utils/atomic-write.js";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const text = z.string().trim().min(1).max(4096);
const assignmentSchema = z
  .object({
    assignment_id: identifier,
    profile: identifier.optional(),
    configuration: identifier.optional(),
    provider: z.enum(["claude", "codex", "copilot", "dsh"]).optional(),
    model: text.optional(),
    reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
    options: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    summary: text,
    scope: text,
    lens: text.optional(),
    selection_reason: text,
    input: z.string().min(1).max(32768),
    source_digest: z.string().regex(/^[a-f0-9]{64}$/),
    context_files: z.array(text).optional(),
    context_manifests: z.array(text).optional(),
    acceptance: z.array(text).min(1),
    max_retries: z.number().int().min(0).max(10),
  })
  .strict();
const draftSchema = z
  .object({
    schema_version: z.literal(2),
    task_id: identifier,
    batch_id: identifier,
    session_id: identifier,
    phase_id: text,
    task_route_revision: text,
    input_revision: text,
    plan_summary: text,
    coordination_mode: z.enum(COORDINATION_MODES).optional(),
    requested_capacity: z.number().int().positive().optional(),
    deadline: text,
    protected_targets: z.array(text).default([]),
    assignments: z.array(assignmentSchema).min(1).max(32),
  })
  .strict();

/** Resolve all mutable project inputs before publishing any immutable batch artifact. */
export function constructTeamworkPlan(input: {
  draft: unknown;
  cwd: string;
  taskRoot: string;
  output: string;
  host: TeammateHostCapabilities;
  dryRun?: boolean;
}): Record<string, unknown> {
  const draft = draftSchema.parse(input.draft);
  const taskRelative = path.relative(
    path.resolve(input.cwd, ".trellis/tasks"),
    path.resolve(input.taskRoot),
  );
  const outputRelative = path.relative(
    path.resolve(input.taskRoot),
    path.resolve(input.output),
  );
  if (
    !taskRelative ||
    taskRelative === ".." ||
    taskRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(taskRelative)
  )
    throw new Error("task root must be inside this project's .trellis/tasks");
  if (
    !outputRelative ||
    outputRelative === ".." ||
    outputRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(outputRelative)
  )
    throw new Error("plan output must be inside its task root");
  const coordination = resolveCoordination(input.cwd, draft.coordination_mode);
  assertCoordinationMembers(coordination.mode, draft.assignments);
  if (
    new Set(draft.assignments.map((entry) => entry.assignment_id)).size !==
    draft.assignments.length
  )
    throw new Error("duplicate assignment id");
  const pending: { file: string; data: string }[] = [];
  const assignments = draft.assignments.map((assignment) => {
    const profile = resolveTeammateProfile({
      cwd: input.cwd,
      profile: assignment.profile,
      configuration: assignment.configuration,
      provider: assignment.provider,
      model: assignment.model,
      reasoningEffort: assignment.reasoning_effort,
      options: assignment.options,
    });
    const launch = buildTeammateLaunchSpec({
      cwd: input.cwd,
      profile,
      host: input.host,
      contextFiles: assignment.context_files,
      contextManifests: assignment.context_manifests,
      protectedTargets: draft.protected_targets,
    });
    const execution = { profile, launch };
    const {
      input: taskInput,
      configuration: _configuration,
      reasoning_effort: _effort,
      options: _options,
      ...fields
    } = assignment;
    const brief = {
      ...fields,
      schema_version: 2,
      task_id: draft.task_id,
      batch_id: draft.batch_id,
      provider: profile.provider,
      profile: profile.profile,
      model: profile.model,
      execution,
      input: taskInput,
      deadline: draft.deadline,
    };
    const briefPath = path.join(
      "teammates",
      draft.batch_id,
      assignment.assignment_id,
      "brief.json",
    );
    pending.push({
      file: path.join(input.taskRoot, briefPath),
      data: `${JSON.stringify(brief, null, 2)}\n`,
    });
    return {
      ...fields,
      provider: profile.provider,
      profile: profile.profile,
      model: profile.model,
      execution,
      brief_path: briefPath,
      brief_digest: computeTeamworkPlanHash(brief),
      ...(coordination.mode === "committee"
        ? { evaluation_group: { id: draft.batch_id, kind: "committee" } }
        : {}),
    };
  });
  const plan: Record<string, unknown> = {
    ...draft,
    coordination_mode: coordination.mode,
    coordination_digest: coordination.configDigest,
    coordination_snapshot: coordination.snapshot,
    assignments,
  };
  plan.plan_hash = computeTeamworkPlanHash(plan);
  // The native task gate is checked before writing, including in preview mode.
  assertTeamworkPlanCurrent(
    {
      taskId: draft.task_id,
      phaseId: draft.phase_id,
      taskRouteRevision: draft.task_route_revision,
      inputRevision: draft.input_revision,
    },
    input.taskRoot,
  );
  const deadline = Date.parse(draft.deadline);
  if (!Number.isFinite(deadline) || deadline <= Date.now())
    throw new Error("deadline must be in the future");
  return publishTeamworkPlan(plan, pending, input);
}

function publishTeamworkPlan(
  plan: Record<string, unknown>,
  pending: { file: string; data: string }[],
  input: { taskRoot: string; output: string; dryRun?: boolean },
): Record<string, unknown> {
  const targets = [
    ...pending,
    { file: input.output, data: `${JSON.stringify(plan, null, 2)}\n` },
  ];
  for (const target of targets) {
    if (fs.existsSync(target.file))
      throw new Error(
        `immutable Teamwork artifact already exists: ${target.file}`,
      );
    let current = path.resolve(target.file);
    while (current !== path.dirname(current)) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw new Error(
          `Teamwork artifact path contains a symlink: ${target.file}`,
        );
      current = path.dirname(current);
    }
  }
  if (Buffer.byteLength(JSON.stringify(plan)) > 2 * 1024 * 1024)
    throw new Error("Teamwork plan exceeds 2097152 bytes");
  validateTeamworkPlan(plan, input.taskRoot, undefined, {
    briefContents: new Map(
      pending.map((entry) => [
        path.relative(input.taskRoot, entry.file),
        entry.data,
      ]),
    ),
  });
  if (input.dryRun) return plan;
  const written: string[] = [];
  try {
    for (const target of targets) {
      fs.mkdirSync(path.dirname(target.file), { recursive: true });
      // Exclusive publication preserves a concurrently created plan or brief.
      const reservation = fs.openSync(target.file, "wx", 0o600);
      fs.closeSync(reservation);
      written.push(target.file);
      writeFileAtomic(target.file, target.data);
    }
    validateTeamworkPlan(plan, input.taskRoot);
    return plan;
  } catch (error) {
    for (const file of written.reverse()) fs.unlinkSync(file);
    throw error;
  }
}

/** A new linked round retries only explicitly selected failed assignments. */
export async function constructTeamworkRetry(input: {
  planPath: string;
  cwd: string;
  taskRoot: string;
  output: string;
  batch: string;
  assignments: string;
  deadline: string;
  approvalRef: string;
}): Promise<Record<string, unknown>> {
  identifier.parse(input.batch);
  if (!input.approvalRef.trim())
    throw new Error("Retry requires an explicit approval reference");
  const relative = path.relative(
    path.resolve(input.taskRoot),
    path.resolve(input.output),
  );
  const taskRelative = path.relative(
    path.resolve(input.cwd, ".trellis/tasks"),
    path.resolve(input.taskRoot),
  );
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !taskRelative ||
    taskRelative.startsWith("..") ||
    path.isAbsolute(taskRelative)
  )
    throw new Error("Retry plan must be inside its project task directory");
  const original = readPlanFile(input.planPath) as Record<string, unknown>;
  const plan = validateTeamworkPlan(original, input.taskRoot, undefined, {
    allowExpired: true,
  });
  assertTeamworkPlanCurrent(plan, input.taskRoot);
  assertFrozenCoordination(
    input.cwd,
    plan.coordinationDigest,
    plan.coordinationSnapshot,
  );
  if (input.batch === plan.batchId)
    throw new Error("Retry must use a new batch identity");
  const selected = input.assignments.split(",").map((entry) => entry.trim());
  if (!selected.length || new Set(selected).size !== selected.length)
    throw new Error("Select unique failed assignment ids");
  const state = await readCoordinationState({
    sessionId: plan.sessionId,
    cwd: input.cwd,
  });
  const events = await readTeamworkEvents({
    sessionId: plan.sessionId,
    cwd: input.cwd,
  });
  const receipt = events
    .filter(
      (event) =>
        event.kind === "coordination" &&
        event.batchId === plan.batchId &&
        event.action === "receipt_recorded" &&
        event.payload?.status === "SETTLED_WITH_FAILURE",
    )
    .pop();
  if (receipt?.kind !== "coordination")
    throw new Error(
      "Retry requires a settled failed batch with a durable receipt",
    );
  await assertTeamworkReceiptDurable(
    plan,
    receipt.payload as unknown as Parameters<
      typeof assertTeamworkReceiptDurable
    >[1],
    input.cwd,
  );
  for (const id of selected) {
    if (
      !plan.assignments.some((entry) => entry.assignmentId === id) ||
      state.assignments.find(
        (entry) => entry.batchId === plan.batchId && entry.assignmentId === id,
      )?.state !== "FINAL_FAILED"
    )
      throw new Error(
        `Assignment ${id} is not a settled failure in the original batch`,
      );
  }
  const retryOf = {
    batch_id: plan.batchId,
    plan_hash: plan.planHash,
    assignment_ids: selected,
    approval_ref: input.approvalRef,
  };
  if (fs.existsSync(input.output)) {
    const existing = readPlanFile(input.output) as Record<string, unknown>;
    const parsed = validateTeamworkPlan(existing, input.taskRoot, undefined, {
      allowExpired: true,
    });
    if (
      parsed.batchId === input.batch &&
      JSON.stringify(existing.retry_of) === JSON.stringify(retryOf) &&
      parsed.deadline === input.deadline
    )
      return existing;
    throw new Error("Retry output already belongs to a different request");
  }
  const pending: { file: string; data: string }[] = [];
  const assignments = (original.assignments as Record<string, unknown>[])
    .filter((entry) => selected.includes(String(entry.assignment_id)))
    .map((entry) => {
      const assignment = plan.assignments.find(
        (candidate) => candidate.assignmentId === entry.assignment_id,
      );
      if (!assignment) throw new Error("Original assignment is missing");
      assertTeammateContextCurrent(assignment.execution.launch, input.cwd);
      const brief = JSON.parse(
        fs.readFileSync(
          path.join(input.taskRoot, assignment.briefPath),
          "utf8",
        ),
      ) as Record<string, unknown>;
      brief.batch_id = input.batch;
      brief.deadline = input.deadline;
      const briefPath = path.join(
        "teammates",
        input.batch,
        assignment.assignmentId,
        "brief.json",
      );
      pending.push({
        file: path.join(input.taskRoot, briefPath),
        data: `${JSON.stringify(brief, null, 2)}\n`,
      });
      const { evaluation_group: _group, ...fields } = entry;
      return {
        ...fields,
        brief_path: briefPath,
        brief_digest: computeTeamworkPlanHash(brief),
      };
    });
  const next: Record<string, unknown> = {
    ...original,
    batch_id: input.batch,
    coordination_mode: "general",
    deadline: input.deadline,
    requested_capacity: Math.min(
      plan.requestedCapacity ?? selected.length,
      selected.length,
    ),
    retry_of: retryOf,
    assignments,
  };
  next.plan_hash = computeTeamworkPlanHash(next);
  return publishTeamworkPlan(next, pending, input);
}
