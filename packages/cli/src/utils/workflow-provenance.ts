import fs from "node:fs";
import path from "node:path";

import { PATHS } from "../constants/paths.js";
import { writeFileAtomic } from "./atomic-write.js";

export const WORKFLOW_PROVENANCE_SCHEMA_VERSION = 1;

export interface WorkflowProvenanceRecord {
  schema_version: typeof WORKFLOW_PROVENANCE_SCHEMA_VERSION;
  workflow_id: string;
  source_kind: "bundled" | "marketplace";
  registry: string;
  ref: string;
  path: string;
  content_sha256: string;
}

export function buildWorkflowProvenanceRecord(input: {
  workflowId: string;
  sourceKind: WorkflowProvenanceRecord["source_kind"];
  registry: string;
  ref: string;
  templatePath: string;
  contentSha256: string;
}): WorkflowProvenanceRecord {
  return {
    schema_version: WORKFLOW_PROVENANCE_SCHEMA_VERSION,
    workflow_id: input.workflowId,
    source_kind: input.sourceKind,
    registry: input.registry,
    ref: input.ref,
    path: input.templatePath,
    content_sha256: input.contentSha256,
  };
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function workflowProvenancePath(cwd: string): string {
  return path.join(cwd, PATHS.WORKFLOW_PROVENANCE_FILE);
}

export function writeWorkflowProvenance(
  cwd: string,
  record: WorkflowProvenanceRecord,
): void {
  const destination = workflowProvenancePath(cwd);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  writeFileAtomic(destination, `${JSON.stringify(record, null, 2)}\n`);
}

export function loadWorkflowProvenance(
  cwd: string,
): WorkflowProvenanceRecord | null {
  const source = workflowProvenancePath(cwd);
  if (!fs.existsSync(source)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(source, "utf-8"));
  } catch (error) {
    throw new Error(
      `Invalid ${PATHS.WORKFLOW_PROVENANCE_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.schema_version !== WORKFLOW_PROVENANCE_SCHEMA_VERSION ||
    typeof parsed.workflow_id !== "string" ||
    (parsed.source_kind !== "bundled" &&
      parsed.source_kind !== "marketplace") ||
    typeof parsed.registry !== "string" ||
    typeof parsed.ref !== "string" ||
    typeof parsed.path !== "string" ||
    typeof parsed.content_sha256 !== "string" ||
    !SHA256_RE.test(parsed.content_sha256)
  ) {
    throw new Error(
      `Invalid ${PATHS.WORKFLOW_PROVENANCE_FILE}: expected schema_version ${WORKFLOW_PROVENANCE_SCHEMA_VERSION} with workflow identity and SHA-256 content hash.`,
    );
  }

  return parsed as unknown as WorkflowProvenanceRecord;
}
