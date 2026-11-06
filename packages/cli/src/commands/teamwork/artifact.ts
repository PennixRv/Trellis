import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  parseFrozenTeammate,
  type TeammateLaunchSpec,
} from "./teammate-launch.js";
import {
  assertCoordinationMembers,
  type CoordinationMode,
} from "./coordination.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./profiles.js";
import { teammateContentSchema, type TeammateContent } from "./result.js";

export type ReportStatus = "complete" | "blocked" | "incomplete" | "error";

export type { CoordinationMode } from "./coordination.js";

export interface TeammateAssignment {
  assignmentId: string;
  evaluationGroup?: { id: string; kind: "committee" };
  briefPath: string;
  roleId: "teammate";
  provider: "claude" | "codex" | "dsh" | "copilot";
  profile?: string;
  model?: string;
  summary: string;
  scope: string;
  lens?: string;
  execution: ReturnType<typeof parseFrozenTeammate>;
  selectionReason: string;
  taskInput: string;
  briefDigest: string;
  sourceDigest: string;
  contextFiles?: string[];
  contextManifests?: string[];
  acceptance: string[];
  maxRetries: number;
}

export interface TeamworkPlan {
  schemaVersion: 2;
  taskId: string;
  batchId: string;
  sessionId: string;
  phaseId: string;
  taskRouteRevision: string;
  inputRevision: string;
  planSummary: string;
  coordinationMode: CoordinationMode;
  coordinationDigest: string;
  coordinationSnapshot?: unknown;
  retryOf?: {
    batchId: string;
    planHash: string;
    assignmentIds: string[];
    approvalRef: string;
  };
  planHash: string;
  requestedCapacity?: number;
  assignments: TeammateAssignment[];
  deadline: string;
  protectedTargets: string[];
}

export interface TeamworkPlanContext {
  taskId: string;
  phaseId: string;
  taskRouteRevision: string;
  inputRevision: string;
}

export interface TeammateReport {
  schemaVersion: 1 | 2;
  content?: TeammateContent;
  taskId: string;
  batchId: string;
  assignmentId: string;
  attemptId: string;
  teammateId: string;
  planHash: string;
  phaseId: string;
  taskRouteRevision: string;
  inputRevision: string;
  status: ReportStatus;
  sourceDigest: string;
  evidence: { id: string; locator: string; summary: string }[];
}

interface TeammateIdentity {
  taskId: string;
  batchId: string;
  assignmentId: string;
  attemptId: string;
  teammateId: string;
}

export type TeammateDispositionStatus = "accepted" | "final_failed";

export type TeammateArtifactIdentity = TeammateIdentity;

export interface TeammateClaim extends TeammateIdentity {
  schemaVersion: 2;
  planHash: string;
  briefDigest?: string;
  sourceDigest: string;
  slot: number;
  status: "issued";
  execution?: TeammateExecutionSnapshot;
}

export interface TeammateExecutionSnapshot {
  roleId: "teammate";
  configuration: string;
  provider: "claude" | "codex" | "dsh" | "copilot";
  profile?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  options: Record<string, string | number | boolean>;
  profileDigest?: string;
  roleDigest: string;
  contextDigest: string;
  capabilityDigest: string;
}

export interface TeammateDisposition extends TeammateArtifactIdentity {
  schemaVersion: 1;
  status: TeammateDispositionStatus;
  sourceDigest: string;
  reason?: string;
}

export interface TeammateQueueFact {
  schemaVersion: 1;
  taskId: string;
  batchId: string;
  assignmentId: string;
  planHash: string;
  briefDigest: string;
  sourceDigest: string;
  briefPath: string;
  queueIndex: number;
  status: "queued";
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SECRET =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|gh[pousr])_[A-Za-z0-9]{20,}\b|\bBearer\s+(?!<(?:redacted|token|placeholder)>(?:\s|[.,;:!?)]|$))\S+)/i;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value))
    throw new Error(`${field} must be a safe id`);
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    value.length > 4096
  ) {
    throw new Error(`${field} must be bounded text`);
  }
  return value;
}

function digest(value: unknown, field: string): string {
  const result = boundedText(value, field);
  if (!/^[a-f0-9]{64}$/i.test(result))
    throw new Error(`${field} must be a SHA-256 digest`);
  return result;
}

function relativePath(value: unknown, field: string): string {
  const result = boundedText(value, field);
  if (path.isAbsolute(result)) throw new Error(`${field} must be relative`);
  const normalized = path.normalize(result);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`${field} must stay within the project root`);
  }
  return normalized;
}

function relativePathList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map((entry, index) =>
    relativePath(entry, `${field}[${index}]`),
  );
  if (new Set(result).size !== result.length)
    throw new Error(`${field} must not contain duplicates`);
  return result;
}

export function safePath(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const lexical = path.resolve(root, candidate);
  const relative = path.relative(absoluteRoot, lexical);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`artifact path escapes task root: ${candidate}`);
  let current = absoluteRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`artifact path contains a symlink: ${candidate}`);
    }
  }
  return lexical;
}

function rejectSecrets(value: unknown, field: string): void {
  const raw = JSON.stringify(value);
  if (raw && SECRET.test(raw))
    throw new Error(`${field} appears to contain a credential`);
}

function attemptArtifactPath(
  taskRoot: string,
  briefPath: string,
  attemptId: string,
  fileName: string,
): string {
  if (!ID.test(attemptId)) throw new Error("attempt id must be safe");
  return safePath(
    taskRoot,
    path.join(path.dirname(briefPath), "attempts", attemptId, fileName),
  );
}

function writeImmutableJson(
  filePath: string,
  value: unknown,
  idempotent = false,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value) + "\n", "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // linkSync is exclusive on the destination and therefore preserves the
    // write-once contract even when another coordinator races this attempt.
    fs.linkSync(temporary, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (
        idempotent &&
        fs.lstatSync(filePath).isFile() &&
        fs.readFileSync(filePath, "utf8") === JSON.stringify(value) + "\n"
      )
        return;
      throw new Error(`artifact already exists: ${filePath}`);
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !fields.includes(field)),
  );
}

export function computeTeamworkPlanHash(value: unknown): string {
  const contents =
    value && typeof value === "object" && !Array.isArray(value)
      ? withoutFields(value as Record<string, unknown>, ["plan_hash"])
      : value;
  return crypto
    .createHash("sha256")
    .update(canonicalJson(contents))
    .digest("hex");
}

export function validateTeamworkPlan(
  input: unknown,
  taskRoot: string,
  expectedContext?: TeamworkPlanContext,
  options: {
    briefContents?: ReadonlyMap<string, string>;
    allowExpired?: boolean;
  } = {},
): TeamworkPlan {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Teamwork plan must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== 2)
    throw new Error(
      "Teamwork plan schema_version must be 2; construct a new frozen plan",
    );
  const taskId = id(value.task_id, "task_id");
  const batchId = id(value.batch_id, "batch_id");
  const sessionId = id(value.session_id, "session_id");
  const phaseId = boundedText(value.phase_id, "phase_id");
  const taskRouteRevision = boundedText(
    value.task_route_revision,
    "task_route_revision",
  );
  const inputRevision = boundedText(value.input_revision, "input_revision");
  const planSummary = boundedText(value.plan_summary, "plan_summary");
  const coordinationDigest = digest(
    value.coordination_digest,
    "coordination_digest",
  );
  const coordinationMode = value.coordination_mode;
  if (
    coordinationMode !== "general" &&
    coordinationMode !== "advisor" &&
    coordinationMode !== "committee"
  ) {
    throw new Error("coordination_mode is unsupported");
  }
  if (expectedContext) {
    for (const [field, expected] of Object.entries({
      task_id: expectedContext.taskId,
      phase_id: expectedContext.phaseId,
      task_route_revision: expectedContext.taskRouteRevision,
      input_revision: expectedContext.inputRevision,
    })) {
      if (value[field] !== expected)
        throw new Error(
          `Teamwork plan ${field} does not match the current task`,
        );
    }
  }
  const deadline = boundedText(value.deadline, "deadline");
  const deadlineAt = Date.parse(deadline);
  if (Number.isNaN(deadlineAt)) throw new Error("deadline must be an ISO date");
  if (!options.allowExpired && deadlineAt <= Date.now())
    throw new Error("deadline must be in the future");
  const assignmentValue = value.assignments;
  if (!Array.isArray(assignmentValue) || assignmentValue.length === 0)
    throw new Error("Teamwork plan assignments must be non-empty");
  if (coordinationMode === "advisor" && assignmentValue.length > 3)
    throw new Error("advisor mode requires one to three assignments");
  if (
    coordinationMode === "committee" &&
    (assignmentValue.length < 2 || assignmentValue.length > 3)
  )
    throw new Error("committee mode requires two or three assignments");

  const seen = new Set<string>();
  const rawAssignments = new Map<string, Record<string, unknown>>();
  const briefs = new Map<string, Record<string, unknown>>();
  const assignments: TeammateAssignment[] = assignmentValue.map(
    (raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`assignments[${index}] must be an object`);
      const item = raw as Record<string, unknown>;
      const assignmentId = id(
        item.assignment_id,
        `assignments[${index}].assignment_id`,
      );
      if (seen.has(assignmentId))
        throw new Error(`duplicate assignment id '${assignmentId}'`);
      seen.add(assignmentId);
      rawAssignments.set(assignmentId, item);
      const evaluationGroupValue = item.evaluation_group;
      let evaluationGroup: TeammateAssignment["evaluationGroup"];
      if (evaluationGroupValue !== undefined) {
        if (
          !evaluationGroupValue ||
          typeof evaluationGroupValue !== "object" ||
          Array.isArray(evaluationGroupValue)
        ) {
          throw new Error(
            `assignments[${index}].evaluation_group must be an object`,
          );
        }
        const group = evaluationGroupValue as Record<string, unknown>;
        if (coordinationMode !== "committee" || group.kind !== "committee")
          throw new Error(
            `assignments[${index}].evaluation_group is unsupported`,
          );
        evaluationGroup = {
          id: id(group.id, `assignments[${index}].evaluation_group.id`),
          kind: "committee",
        };
      } else if (coordinationMode === "committee") {
        throw new Error(
          `assignments[${index}] must declare an evaluation group`,
        );
      }
      if (item.role_id !== undefined)
        throw new Error(
          `assignments[${index}].role_id is retired; teammate is an internal execution type`,
        );
      const execution = parseFrozenTeammate(item.execution);
      const selectionReason = boundedText(
        item.selection_reason,
        `assignments[${index}].selection_reason`,
      );
      const provider = item.provider;
      if (
        provider !== "claude" &&
        provider !== "codex" &&
        provider !== "dsh" &&
        provider !== "copilot"
      ) {
        throw new Error(`assignments[${index}].provider is unsupported`);
      }
      const acceptance = item.acceptance;
      if (!Array.isArray(acceptance) || acceptance.length === 0)
        throw new Error(`assignments[${index}].acceptance must be non-empty`);
      const maxRetries = item.max_retries;
      if (!Number.isInteger(maxRetries) || (maxRetries as number) < 0)
        throw new Error(
          `assignments[${index}].max_retries must be non-negative`,
        );
      const briefPath = boundedText(
        item.brief_path,
        `assignments[${index}].brief_path`,
      );
      const scope = boundedText(item.scope, `assignments[${index}].scope`);
      const lens =
        item.lens === undefined
          ? undefined
          : boundedText(item.lens, `assignments[${index}].lens`);
      const summary = boundedText(
        item.summary,
        `assignments[${index}].summary`,
      );
      const briefDigest = digest(
        item.brief_digest,
        `assignments[${index}].brief_digest`,
      );
      const sourceDigest = digest(
        item.source_digest,
        `assignments[${index}].source_digest`,
      );
      const contextFiles = relativePathList(
        item.context_files,
        `assignments[${index}].context_files`,
      );
      const contextManifests = relativePathList(
        item.context_manifests,
        `assignments[${index}].context_manifests`,
      );
      const profile =
        item.profile === undefined
          ? undefined
          : id(item.profile, `assignments[${index}].profile`);
      const model =
        item.model === undefined
          ? undefined
          : boundedText(item.model, `assignments[${index}].model`);
      const absoluteBrief = safePath(taskRoot, briefPath);
      const expectedRelative = path.join(
        "teammates",
        batchId,
        assignmentId,
        "brief.json",
      );
      if (
        path.relative(path.resolve(taskRoot), absoluteBrief) !==
        expectedRelative
      )
        throw new Error(
          `assignments[${index}].brief_path must be ${expectedRelative}`,
        );
      const prepared = options.briefContents?.get(briefPath);
      if (options.briefContents && prepared === undefined)
        throw new Error(`missing prepared brief: ${briefPath}`);
      const briefBytes =
        prepared === undefined
          ? fs.readFileSync(absoluteBrief)
          : Buffer.from(prepared);
      if (briefBytes.byteLength > 64 * 1024)
        throw new Error(
          `brief for assignment '${assignmentId}' exceeds 65536 bytes`,
        );
      const brief = JSON.parse(briefBytes.toString("utf8")) as Record<
        string,
        unknown
      >;
      if (!brief || typeof brief !== "object" || Array.isArray(brief))
        throw new Error(
          `brief for assignment '${assignmentId}' must be an object`,
        );
      if (
        typeof brief.input !== "string" ||
        brief.input.trim() === "" ||
        brief.input.length > 32768 ||
        brief.input.includes("\0")
      )
        throw new Error(
          "brief.input must be nonempty task text of at most 32768 characters",
        );
      briefs.set(assignmentId, brief);
      rejectSecrets(brief, `brief for assignment '${assignmentId}'`);
      if (computeTeamworkPlanHash(brief) !== briefDigest)
        throw new Error(
          `brief.${assignmentId} digest does not match the Teamwork plan`,
        );
      for (const [field, expected] of Object.entries({
        schema_version: 2,
        task_id: taskId,
        batch_id: batchId,
        assignment_id: assignmentId,
        provider,
        summary,
        scope,
        lens,
        deadline,
      })) {
        if (brief[field] !== expected)
          throw new Error(`brief.${field} does not match the Teamwork plan`);
      }
      if (brief.role_id !== undefined)
        throw new Error("brief.role_id is retired");
      if (canonicalJson(brief.execution) !== canonicalJson(item.execution))
        throw new Error("brief.execution does not match the frozen plan");
      if (brief.selection_reason !== selectionReason)
        throw new Error(
          "brief.selection_reason does not match the frozen plan",
        );
      if (
        execution.profile.provider !== provider ||
        execution.profile.profile !== profile ||
        execution.profile.model !== model
      )
        throw new Error(
          "assignment provider, profile, or model does not match frozen execution",
        );
      const briefSourceDigest = digest(
        brief.source_digest,
        `brief.${assignmentId}.source_digest`,
      );
      if (briefSourceDigest !== sourceDigest)
        throw new Error(
          `brief.${assignmentId}.source_digest does not match the Teamwork plan`,
        );
      for (const [field, expected] of [
        ["context_files", contextFiles],
        ["context_manifests", contextManifests],
      ] as const) {
        const actual = relativePathList(
          brief[field],
          `brief.${assignmentId}.${field}`,
        );
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error(`brief.${field} does not match the Teamwork plan`);
      }
      for (const field of ["profile", "model"] as const) {
        if (item[field] !== undefined && brief[field] !== item[field])
          throw new Error(`brief.${field} does not match the Teamwork plan`);
        if (item[field] === undefined && brief[field] !== undefined)
          throw new Error(
            `brief.${field} is not declared by the Teamwork plan`,
          );
      }
      const briefAcceptance = brief.acceptance;
      if (
        !Array.isArray(briefAcceptance) ||
        JSON.stringify(briefAcceptance) !== JSON.stringify(acceptance)
      )
        throw new Error(
          `brief acceptance contract does not match assignment '${assignmentId}'`,
        );
      const assignment: TeammateAssignment = {
        assignmentId,
        ...(evaluationGroup ? { evaluationGroup } : {}),
        briefPath,
        roleId: "teammate",
        provider,
        ...(profile ? { profile } : {}),
        ...(model ? { model } : {}),
        summary,
        scope,
        lens,
        execution,
        selectionReason,
        taskInput: brief.input,
        briefDigest,
        sourceDigest,
        ...(contextFiles ? { contextFiles } : {}),
        ...(contextManifests ? { contextManifests } : {}),
        acceptance: acceptance.map((entry, acceptanceIndex) =>
          boundedText(
            entry,
            `assignments[${index}].acceptance[${acceptanceIndex}]`,
          ),
        ),
        maxRetries: maxRetries as number,
      };
      rejectSecrets(assignment, `assignments[${index}]`);
      return assignment;
    },
  );

  assertCoordinationMembers(coordinationMode, assignments);

  if (coordinationMode === "committee") {
    const groups = new Map<string, TeammateAssignment[]>();
    for (const assignment of assignments) {
      const group = assignment.evaluationGroup;
      if (!group)
        throw new Error("committee assignments require an evaluation group");
      const members = groups.get(group.id) ?? [];
      members.push(assignment);
      groups.set(group.id, members);
    }
    if (groups.size !== 1)
      throw new Error("committee assignments must share one evaluation group");
    const members = [...groups.values()][0] ?? [];
    if (members.length < 2 || members.length > 3)
      throw new Error(
        "committee evaluation group requires two or three assignments",
      );
    if (
      new Set(members.map((assignment) => assignment.lens)).size !==
      members.length
    )
      throw new Error("committee assignments must use distinct lenses");
    const assignmentFields = [
      "assignment_id",
      "provider",
      "profile",
      "model",
      "lens",
      "brief_path",
      "brief_digest",
      "execution",
      "selection_reason",
    ];
    const briefFields = [
      "assignment_id",
      "provider",
      "profile",
      "model",
      "lens",
      "execution",
      "selection_reason",
    ];
    const first = members[0];
    if (!first) throw new Error("committee has no assignments");
    for (const other of members.slice(1)) {
      const firstRaw = rawAssignments.get(first.assignmentId);
      const otherRaw = rawAssignments.get(other.assignmentId);
      const firstBrief = briefs.get(first.assignmentId);
      const otherBrief = briefs.get(other.assignmentId);
      if (!firstRaw || !otherRaw || !firstBrief || !otherBrief)
        throw new Error("committee is missing frozen artifacts");
      if (
        canonicalJson(withoutFields(firstRaw, assignmentFields)) !==
        canonicalJson(withoutFields(otherRaw, assignmentFields))
      )
        throw new Error(
          "committee assignments must share the same assignment contract",
        );
      if (
        canonicalJson(withoutFields(firstBrief, briefFields)) !==
        canonicalJson(withoutFields(otherBrief, briefFields))
      )
        throw new Error(
          "committee assignments must share the same brief contract",
        );
    }
  }
  if (
    !Array.isArray(value.protected_targets) &&
    value.protected_targets !== undefined
  )
    throw new Error("protected_targets must be an array");
  const protectedTargets = (value.protected_targets ?? []).map((entry, index) =>
    boundedText(entry, `protected_targets[${index}]`),
  );
  if (new Set(protectedTargets).size !== protectedTargets.length)
    throw new Error("protected_targets must not contain duplicates");
  const requestedCapacityValue = value.requested_capacity;
  let retryOf: TeamworkPlan["retryOf"];
  if (value.retry_of !== undefined) {
    const retry = value.retry_of as Record<string, unknown>;
    const assignmentIds = retry?.assignment_ids;
    if (
      !retry ||
      typeof retry !== "object" ||
      !Array.isArray(assignmentIds) ||
      assignmentIds.length !== assignments.length ||
      new Set(assignmentIds).size !== assignments.length ||
      assignments.some((entry) => !assignmentIds.includes(entry.assignmentId))
    )
      throw new Error(
        "Retry lineage must contain the exact selected assignment set",
      );
    retryOf = {
      batchId: id(retry.batch_id, "retry_of.batch_id"),
      planHash: digest(retry.plan_hash, "retry_of.plan_hash"),
      assignmentIds: assignmentIds.map((entry) =>
        id(entry, "retry_of.assignment_ids"),
      ),
      approvalRef: boundedText(retry.approval_ref, "retry_of.approval_ref"),
    };
    if (retryOf.batchId === batchId)
      throw new Error("Retry must use a new batch identity");
  }
  if (
    requestedCapacityValue !== undefined &&
    (!Number.isInteger(requestedCapacityValue) ||
      (requestedCapacityValue as number) <= 0)
  )
    throw new Error("requested_capacity must be a positive integer");
  const plan: TeamworkPlan = {
    schemaVersion: 2,
    taskId,
    batchId,
    sessionId,
    phaseId,
    taskRouteRevision,
    inputRevision,
    planSummary,
    coordinationMode,
    coordinationDigest,
    ...(retryOf ? { retryOf } : {}),
    ...(value.coordination_snapshot
      ? { coordinationSnapshot: value.coordination_snapshot }
      : {}),
    planHash: boundedText(value.plan_hash, "plan_hash"),
    ...(requestedCapacityValue !== undefined
      ? { requestedCapacity: requestedCapacityValue as number }
      : {}),
    assignments,
    deadline,
    protectedTargets,
  };
  if (
    !/^[a-f0-9]{64}$/i.test(plan.planHash) ||
    plan.planHash !== computeTeamworkPlanHash(value)
  )
    throw new Error("Teamwork plan hash does not match its immutable contents");
  rejectSecrets(plan, "Teamwork plan");
  return plan;
}

export function validateTeammateReport(
  input: unknown,
  identity: Pick<
    TeammateReport,
    | "taskId"
    | "batchId"
    | "assignmentId"
    | "attemptId"
    | "teammateId"
    | "planHash"
    | "phaseId"
    | "taskRouteRevision"
    | "inputRevision"
  >,
  expectedSourceDigest: string,
): TeammateReport {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("teammate report must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== 1 && value.schema_version !== 2)
    throw new Error("teammate report schema_version must be 1 or 2");
  if (value.schema_version === 2) {
    const allowed = new Set([
      ...Object.keys(teammateContentSchema.shape),
      "task_id",
      "batch_id",
      "assignment_id",
      "attempt_id",
      "teammate_id",
      "plan_hash",
      "phase_id",
      "task_route_revision",
      "input_revision",
      "source_digest",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
      throw new Error("teammate report contains unknown fields");
  }
  const content =
    value.schema_version === 2
      ? teammateContentSchema.parse(
          Object.fromEntries(
            Object.keys(teammateContentSchema.shape).map((key) => [
              key,
              value[key],
            ]),
          ),
        )
      : undefined;
  for (const key of [
    "task_id",
    "batch_id",
    "assignment_id",
    "attempt_id",
    "teammate_id",
    "plan_hash",
    "phase_id",
    "task_route_revision",
    "input_revision",
  ] as const) {
    const expected =
      identity[
        key === "task_id"
          ? "taskId"
          : key === "batch_id"
            ? "batchId"
            : key === "assignment_id"
              ? "assignmentId"
              : key === "attempt_id"
                ? "attemptId"
                : key === "teammate_id"
                  ? "teammateId"
                  : key === "plan_hash"
                    ? "planHash"
                    : key === "phase_id"
                      ? "phaseId"
                      : key === "task_route_revision"
                        ? "taskRouteRevision"
                        : "inputRevision"
      ];
    if (value[key] !== expected)
      throw new Error(`report.${key} does not match the assigned identity`);
  }
  const status = value.status;
  if (
    status !== "complete" &&
    status !== "blocked" &&
    status !== "incomplete" &&
    status !== "error"
  )
    throw new Error("report.status is invalid");
  const sourceDigest = boundedText(value.source_digest, "report.source_digest");
  if (sourceDigest !== expectedSourceDigest)
    throw new Error("report source digest does not match the assigned brief");
  if (!Array.isArray(value.evidence))
    throw new Error("report.evidence must be an array");
  const evidence = value.evidence.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`report.evidence[${index}] must be an object`);
    const item = entry as Record<string, unknown>;
    return {
      id: id(item.id, `report.evidence[${index}].id`),
      locator: boundedText(item.locator, `report.evidence[${index}].locator`),
      summary: boundedText(item.summary, `report.evidence[${index}].summary`),
    };
  });
  if (evidence.length === 0)
    throw new Error("report.evidence must include at least one item");
  const report: TeammateReport = {
    schemaVersion: value.schema_version,
    ...(content ? { content } : {}),
    taskId: identity.taskId,
    batchId: identity.batchId,
    assignmentId: identity.assignmentId,
    attemptId: identity.attemptId,
    teammateId: identity.teammateId,
    planHash: identity.planHash,
    phaseId: identity.phaseId,
    taskRouteRevision: identity.taskRouteRevision,
    inputRevision: identity.inputRevision,
    status,
    sourceDigest,
    evidence,
  };
  rejectSecrets(report, "teammate report");
  return report;
}

export function validateTeammateQueueFact(
  input: unknown,
  identity: Pick<TeammateQueueFact, "taskId" | "batchId" | "assignmentId">,
  expectedPlanHash: string,
  expectedBriefDigest: string,
  expectedSourceDigest: string,
): TeammateQueueFact {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("teammate queue fact must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== 1)
    throw new Error("teammate queue fact schema_version must be 1");
  for (const key of ["task_id", "batch_id", "assignment_id"] as const) {
    const expected =
      identity[
        key === "task_id"
          ? "taskId"
          : key === "batch_id"
            ? "batchId"
            : "assignmentId"
      ];
    if (value[key] !== expected)
      throw new Error(`queue.${key} does not match the assigned work`);
  }
  const planHash = digest(value.plan_hash, "queue.plan_hash");
  if (planHash !== expectedPlanHash)
    throw new Error("queue plan hash does not match the batch plan");
  const briefDigest = digest(value.brief_digest, "queue.brief_digest");
  if (briefDigest !== expectedBriefDigest)
    throw new Error("queue brief digest does not match the assigned work");
  const sourceDigest = digest(value.source_digest, "queue.source_digest");
  if (sourceDigest !== expectedSourceDigest)
    throw new Error("queue source digest does not match the assigned brief");
  const briefPath = relativePath(value.brief_path, "queue.brief_path");
  const expectedBriefPath = path.join(
    "teammates",
    identity.batchId,
    identity.assignmentId,
    "brief.json",
  );
  if (briefPath !== expectedBriefPath)
    throw new Error("queue.brief_path is not the canonical work brief path");
  if (value.status !== "queued") throw new Error("queue.status must be queued");
  if (!Number.isInteger(value.queue_index) || (value.queue_index as number) < 0)
    throw new Error("queue.queue_index must be non-negative");
  const queue: TeammateQueueFact = {
    schemaVersion: 1,
    ...identity,
    planHash,
    briefDigest,
    sourceDigest,
    briefPath,
    queueIndex: value.queue_index as number,
    status: "queued",
  };
  rejectSecrets(queue, "teammate queue fact");
  return queue;
}

export function validateTeammateClaim(
  input: unknown,
  identity: TeammateArtifactIdentity,
  expectedPlanHash: string,
  expectedSourceDigest: string,
  expectedBriefDigest?: string,
): TeammateClaim {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("teammate claim must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== 2)
    throw new Error("teammate claim schema_version must be 2");
  for (const key of [
    "task_id",
    "batch_id",
    "assignment_id",
    "attempt_id",
    "teammate_id",
  ] as const) {
    const expected =
      identity[
        key === "task_id"
          ? "taskId"
          : key === "batch_id"
            ? "batchId"
            : key === "assignment_id"
              ? "assignmentId"
              : key === "attempt_id"
                ? "attemptId"
                : "teammateId"
      ];
    if (value[key] !== expected)
      throw new Error(`claim.${key} does not match the assigned identity`);
  }
  const planHash = digest(value.plan_hash, "claim.plan_hash");
  if (planHash !== expectedPlanHash)
    throw new Error("claim plan hash does not match the batch plan");
  const sourceDigest = digest(value.source_digest, "claim.source_digest");
  if (sourceDigest !== expectedSourceDigest)
    throw new Error("claim source digest does not match the assigned brief");
  const briefDigest =
    value.brief_digest === undefined
      ? undefined
      : digest(value.brief_digest, "claim.brief_digest");
  if (expectedBriefDigest && briefDigest !== expectedBriefDigest)
    throw new Error("claim brief digest does not match the assigned work");
  if (value.status !== "issued") throw new Error("claim.status must be issued");
  if (!Number.isInteger(value.slot) || (value.slot as number) < 0)
    throw new Error("claim.slot must be non-negative");
  const snapshotKeys = [
    "configuration",
    "provider",
    "profile",
    "model",
    "reasoning_effort",
    "options",
    "profile_digest",
    "role_digest",
    "context_digest",
    "capability_digest",
  ];
  const hasSnapshot = snapshotKeys.some((key) => value[key] !== undefined);
  let execution: TeammateExecutionSnapshot | undefined;
  if (hasSnapshot) {
    if (value.role_id !== undefined)
      throw new Error("claim.role_id is retired");
    const provider = value.provider;
    if (
      provider !== "claude" &&
      provider !== "codex" &&
      provider !== "dsh" &&
      provider !== "copilot"
    ) {
      throw new Error("claim.provider is unsupported");
    }
    const profile =
      value.profile === undefined
        ? undefined
        : id(value.profile, "claim.profile");
    const model =
      value.model === undefined
        ? undefined
        : boundedText(value.model, "claim.model");
    if (model && (model.length > 256 || /[\r\n]/.test(model)))
      throw new Error("claim.model must be bounded single-line text");
    const reasoningEffort = value.reasoning_effort;
    if (
      reasoningEffort !== undefined &&
      !REASONING_EFFORTS.includes(reasoningEffort as ReasoningEffort)
    ) {
      throw new Error("claim.reasoning_effort is invalid");
    }
    if (
      !value.options ||
      typeof value.options !== "object" ||
      Array.isArray(value.options)
    )
      throw new Error("claim.options must be an object");
    if (Object.keys(value.options).length > 32)
      throw new Error("claim.options has too many entries");
    const options: Record<string, string | number | boolean> = {};
    for (const [key, option] of Object.entries(value.options)) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(key))
        throw new Error("claim.options has an invalid key");
      if (
        typeof option !== "string" &&
        typeof option !== "number" &&
        typeof option !== "boolean"
      ) {
        throw new Error(`claim.options.${key} must be a scalar`);
      }
      if (
        (typeof option === "number" && !Number.isFinite(option)) ||
        (typeof option === "string" &&
          (option.trim() === "" ||
            option.length > 256 ||
            /[\r\n\0]/.test(option)))
      ) {
        throw new Error(`claim.options.${key} must be bounded scalar data`);
      }
      options[key] = option;
    }
    execution = {
      roleId: "teammate",
      configuration: id(value.configuration, "claim.configuration"),
      provider,
      ...(profile ? { profile } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort
        ? { reasoningEffort: reasoningEffort as ReasoningEffort }
        : {}),
      options,
      ...(value.profile_digest === undefined
        ? {}
        : {
            profileDigest: digest(value.profile_digest, "claim.profile_digest"),
          }),
      roleDigest: digest(value.role_digest, "claim.role_digest"),
      contextDigest: digest(value.context_digest, "claim.context_digest"),
      capabilityDigest: digest(
        value.capability_digest,
        "claim.capability_digest",
      ),
    };
  }
  const claim: TeammateClaim = {
    schemaVersion: 2,
    ...identity,
    planHash,
    ...(briefDigest ? { briefDigest } : {}),
    sourceDigest,
    slot: value.slot as number,
    status: "issued",
    ...(execution ? { execution } : {}),
  };
  rejectSecrets(claim, "teammate claim");
  return claim;
}

export function validateTeammateDisposition(
  input: unknown,
  identity: TeammateArtifactIdentity,
  expectedSourceDigest: string,
): TeammateDisposition {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("teammate disposition must be an object");
  const value = input as Record<string, unknown>;
  if (value.schema_version !== 1)
    throw new Error("teammate disposition schema_version must be 1");
  for (const key of [
    "task_id",
    "batch_id",
    "assignment_id",
    "attempt_id",
    "teammate_id",
  ] as const) {
    const expected =
      identity[
        key === "task_id"
          ? "taskId"
          : key === "batch_id"
            ? "batchId"
            : key === "assignment_id"
              ? "assignmentId"
              : key === "attempt_id"
                ? "attemptId"
                : "teammateId"
      ];
    if (value[key] !== expected)
      throw new Error(
        `disposition.${key} does not match the assigned identity`,
      );
  }
  if (value.status !== "accepted" && value.status !== "final_failed") {
    throw new Error("disposition.status is invalid");
  }
  const sourceDigest = digest(value.source_digest, "disposition.source_digest");
  if (sourceDigest !== expectedSourceDigest)
    throw new Error(
      "disposition source digest does not match the assigned brief",
    );
  const reason =
    value.reason === undefined
      ? undefined
      : boundedText(value.reason, "disposition.reason");
  if (value.status === "final_failed" && reason === undefined)
    throw new Error("final_failed disposition requires a reason");
  return {
    schemaVersion: 1,
    ...identity,
    status: value.status,
    sourceDigest,
    ...(reason ? { reason } : {}),
  };
}

export function writeTeammateClaim(input: {
  taskRoot: string;
  briefPath: string;
  identity: TeammateArtifactIdentity;
  planHash: string;
  briefDigest: string;
  sourceDigest: string;
  slot: number;
  launch?: TeammateLaunchSpec;
}): void {
  const execution = input.launch
    ? {
        configuration: input.launch.configuration,
        provider: input.launch.provider,
        ...(input.launch.profile ? { profile: input.launch.profile } : {}),
        ...(input.launch.model ? { model: input.launch.model } : {}),
        ...(input.launch.reasoningEffort
          ? { reasoning_effort: input.launch.reasoningEffort }
          : {}),
        options: input.launch.options,
        ...(input.launch.profileDigest
          ? { profile_digest: input.launch.profileDigest }
          : {}),
        role_digest: input.launch.roleDigest,
        context_digest: input.launch.contextDigest,
        capability_digest: input.launch.capability.digest,
      }
    : undefined;
  const claim: TeammateClaim = validateTeammateClaim(
    {
      schema_version: 2,
      task_id: input.identity.taskId,
      batch_id: input.identity.batchId,
      assignment_id: input.identity.assignmentId,
      attempt_id: input.identity.attemptId,
      teammate_id: input.identity.teammateId,
      plan_hash: input.planHash,
      brief_digest: input.briefDigest,
      source_digest: input.sourceDigest,
      slot: input.slot,
      status: "issued",
      ...(execution ?? {}),
    },
    input.identity,
    input.planHash,
    input.sourceDigest,
    input.briefDigest,
  );
  writeImmutableJson(
    attemptArtifactPath(
      input.taskRoot,
      input.briefPath,
      input.identity.attemptId,
      "claim.json",
    ),
    {
      schema_version: claim.schemaVersion,
      task_id: claim.taskId,
      batch_id: claim.batchId,
      assignment_id: claim.assignmentId,
      attempt_id: claim.attemptId,
      teammate_id: claim.teammateId,
      plan_hash: claim.planHash,
      ...(claim.briefDigest ? { brief_digest: claim.briefDigest } : {}),
      source_digest: claim.sourceDigest,
      slot: claim.slot,
      status: claim.status,
      ...(claim.execution
        ? {
            configuration: claim.execution.configuration,
            provider: claim.execution.provider,
            ...(claim.execution.profile
              ? { profile: claim.execution.profile }
              : {}),
            ...(claim.execution.model ? { model: claim.execution.model } : {}),
            ...(claim.execution.reasoningEffort
              ? { reasoning_effort: claim.execution.reasoningEffort }
              : {}),
            options: claim.execution.options,
            ...(claim.execution.profileDigest
              ? { profile_digest: claim.execution.profileDigest }
              : {}),
            role_digest: claim.execution.roleDigest,
            context_digest: claim.execution.contextDigest,
            capability_digest: claim.execution.capabilityDigest,
          }
        : {}),
    },
  );
}

export function writeTeammateQueueFact(input: {
  taskRoot: string;
  briefPath: string;
  taskId: string;
  batchId: string;
  assignmentId: string;
  planHash: string;
  briefDigest: string;
  sourceDigest: string;
  queueIndex: number;
}): void {
  const queue = validateTeammateQueueFact(
    {
      schema_version: 1,
      task_id: input.taskId,
      batch_id: input.batchId,
      assignment_id: input.assignmentId,
      plan_hash: input.planHash,
      brief_digest: input.briefDigest,
      source_digest: input.sourceDigest,
      brief_path: input.briefPath,
      queue_index: input.queueIndex,
      status: "queued",
    },
    {
      taskId: input.taskId,
      batchId: input.batchId,
      assignmentId: input.assignmentId,
    },
    input.planHash,
    input.briefDigest,
    input.sourceDigest,
  );
  writeImmutableJson(
    safePath(
      input.taskRoot,
      path.join(path.dirname(input.briefPath), "queue.json"),
    ),
    {
      schema_version: queue.schemaVersion,
      task_id: queue.taskId,
      batch_id: queue.batchId,
      assignment_id: queue.assignmentId,
      plan_hash: queue.planHash,
      brief_digest: queue.briefDigest,
      source_digest: queue.sourceDigest,
      brief_path: queue.briefPath,
      queue_index: queue.queueIndex,
      status: queue.status,
    },
  );
}

export function appendTeammateWorklog(input: {
  taskRoot: string;
  briefPath: string;
  attemptId: string;
  checkpoint: string;
}): void {
  const checkpoint = boundedText(input.checkpoint, "worklog.checkpoint");
  rejectSecrets(checkpoint, "worklog.checkpoint");
  const filePath = attemptArtifactPath(
    input.taskRoot,
    input.briefPath,
    input.attemptId,
    "worklog.md",
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeFileSync(fd, `${checkpoint}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function writeTeammateReport(input: {
  taskRoot: string;
  briefPath: string;
  identity: Pick<
    TeammateReport,
    | "taskId"
    | "batchId"
    | "assignmentId"
    | "attemptId"
    | "teammateId"
    | "planHash"
    | "phaseId"
    | "taskRouteRevision"
    | "inputRevision"
  >;
  sourceDigest: string;
  status: ReportStatus;
  evidence: TeammateReport["evidence"];
  content?: TeammateContent;
}): void {
  if (
    input.content &&
    (input.content.status !== input.status ||
      JSON.stringify(input.content.evidence) !== JSON.stringify(input.evidence))
  )
    throw new Error(
      "report content status/evidence must match the submitted report",
    );
  const report = validateTeammateReport(
    {
      ...input.content,
      schema_version: input.content ? 2 : 1,
      task_id: input.identity.taskId,
      batch_id: input.identity.batchId,
      assignment_id: input.identity.assignmentId,
      attempt_id: input.identity.attemptId,
      teammate_id: input.identity.teammateId,
      plan_hash: input.identity.planHash,
      phase_id: input.identity.phaseId,
      task_route_revision: input.identity.taskRouteRevision,
      input_revision: input.identity.inputRevision,
      status: input.status,
      source_digest: input.sourceDigest,
      evidence: input.evidence,
    },
    input.identity,
    input.sourceDigest,
  );
  writeImmutableJson(
    attemptArtifactPath(
      input.taskRoot,
      input.briefPath,
      input.identity.attemptId,
      "report.json",
    ),
    {
      ...report.content,
      schema_version: report.schemaVersion,
      task_id: report.taskId,
      batch_id: report.batchId,
      assignment_id: report.assignmentId,
      attempt_id: report.attemptId,
      teammate_id: report.teammateId,
      plan_hash: report.planHash,
      phase_id: report.phaseId,
      task_route_revision: report.taskRouteRevision,
      input_revision: report.inputRevision,
      status: report.status,
      source_digest: report.sourceDigest,
      evidence: report.evidence,
    },
  );
}

export function assertTeammateWriteAllowed(
  target: string,
  protectedTargets: readonly string[],
): void {
  const normalizedTarget = path.normalize(target);
  for (const protectedTarget of protectedTargets) {
    const normalizedProtected = path.normalize(protectedTarget);
    if (
      normalizedTarget === normalizedProtected ||
      normalizedTarget.startsWith(`${normalizedProtected}${path.sep}`)
    ) {
      throw new Error(`teammate write targets protected path: ${target}`);
    }
  }
}

export function writeTeammateDisposition(input: {
  taskRoot: string;
  briefPath: string;
  identity: TeammateArtifactIdentity;
  sourceDigest: string;
  status: TeammateDispositionStatus;
  reason?: string;
  review?: {
    plan_hash: string;
    phase_id: string;
    task_route_revision: string;
    input_revision: string;
    report_sha256: string;
    acceptance: string[];
    by: string;
  };
}): void {
  const disposition = validateTeammateDisposition(
    {
      schema_version: 1,
      task_id: input.identity.taskId,
      batch_id: input.identity.batchId,
      assignment_id: input.identity.assignmentId,
      attempt_id: input.identity.attemptId,
      teammate_id: input.identity.teammateId,
      status: input.status,
      source_digest: input.sourceDigest,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    input.identity,
    input.sourceDigest,
  );
  writeImmutableJson(
    attemptArtifactPath(
      input.taskRoot,
      input.briefPath,
      input.identity.attemptId,
      "disposition.json",
    ),
    {
      schema_version: disposition.schemaVersion,
      task_id: disposition.taskId,
      batch_id: disposition.batchId,
      assignment_id: disposition.assignmentId,
      attempt_id: disposition.attemptId,
      teammate_id: disposition.teammateId,
      status: disposition.status,
      source_digest: disposition.sourceDigest,
      ...(disposition.reason ? { reason: disposition.reason } : {}),
      ...(input.review ? { review: input.review } : {}),
    },
    input.review !== undefined,
  );
}

export class TeammateReportReadError extends Error {
  constructor(
    readonly kind: "missing" | "storage" | "incomplete",
    message: string,
  ) {
    super(message);
    this.name = "TeammateReportReadError";
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function readTeammateReport(input: {
  taskRoot: string;
  briefPath: string;
  attemptId: string;
  identity: Pick<
    TeammateReport,
    | "taskId"
    | "batchId"
    | "assignmentId"
    | "teammateId"
    | "planHash"
    | "phaseId"
    | "taskRouteRevision"
    | "inputRevision"
  >;
  sourceDigest: string;
}): TeammateReport {
  if (!ID.test(input.attemptId)) throw new Error("attempt id must be safe");
  let reportPath: string;
  try {
    reportPath = safePath(
      input.taskRoot,
      path.join(
        path.dirname(input.briefPath),
        "attempts",
        input.attemptId,
        "report.json",
      ),
    );
  } catch {
    throw new TeammateReportReadError(
      "storage",
      "teammate report path is unsafe",
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(reportPath);
  } catch (error) {
    if (isMissingFile(error))
      throw new TeammateReportReadError(
        "missing",
        "teammate report is missing",
      );
    throw new TeammateReportReadError(
      "storage",
      "could not inspect teammate report",
    );
  }
  if (!stat.isFile() || stat.size > 128 * 1024)
    throw new TeammateReportReadError(
      "storage",
      "teammate report must be a regular file under 131072 bytes",
    );
  let raw: string;
  try {
    raw = fs.readFileSync(reportPath, "utf8");
  } catch (error) {
    if (isMissingFile(error))
      throw new TeammateReportReadError(
        "missing",
        "teammate report is missing",
      );
    throw new TeammateReportReadError(
      "storage",
      "could not read teammate report",
    );
  }
  let report: unknown;
  try {
    report = JSON.parse(raw) as unknown;
  } catch {
    throw new TeammateReportReadError(
      "incomplete",
      "teammate report is not complete JSON",
    );
  }
  rejectSecrets(report, "teammate report");
  return validateTeammateReport(
    report,
    { ...input.identity, attemptId: input.attemptId },
    input.sourceDigest,
  );
}
