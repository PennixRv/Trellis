/**
 * Trellis Context Manager
 *
 * Utility class for OpenCode plugins providing file reading,
 * JSONL parsing, and context building capabilities.
 */

/**
 * Trellis Context Manager
 *
 * Utility class for OpenCode plugins providing file reading,
 * JSONL parsing, and context building capabilities.
 */
import { existsSync, readFileSync, appendFileSync, readdirSync, realpathSync } from "fs";
import { isAbsolute, join, relative } from "path";
import { platform } from "os";
import { execSync } from "child_process";
import { createHash } from "crypto";

import process from "process"

const PYTHON_CMD = platform() === "win32" ? "python" : "python3"
// Debug logging
const DEBUG_LOG = "/tmp/trellis-plugin-debug.log"

function debugLog(prefix, ...args) {
  const timestamp = new Date().toISOString()
  const msg = `[${timestamp}] [${prefix}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`
  try {
    appendFileSync(DEBUG_LOG, msg)
  } catch {
    // ignore
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function sanitizeKey(raw) {
  const safe = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "")
  return safe ? safe.slice(0, 160) : ""
}

function hashValue(raw) {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24)
}

function lookupString(data, keys) {
  if (!data || typeof data !== "object") return null
  for (const key of keys) {
    const value = stringValue(data[key])
    if (value) return value
  }
  for (const nestedKey of ["input", "properties", "event", "hook_input", "hookInput"]) {
    const nested = data[nestedKey]
    if (nested && typeof nested === "object") {
      const value = lookupString(nested, keys)
      if (value) return value
    }
  }
  return null
}

function buildContextKey(platformName, kind, value) {
  if (kind === "transcript") {
    return `${platformName}_transcript_${hashValue(value)}`
  }
  const safeValue = sanitizeKey(value)
  return safeValue ? `${platformName}_${safeValue}` : `${platformName}_${hashValue(value)}`
}

export class TrellisContext {
  constructor(directory) {
    this.directory = directory
    debugLog("context", "TrellisContext initialized", { directory })
  }

  // ============================================================
  // Trellis Project Detection
  // ============================================================

  isTrellisProject() {
    return existsSync(join(this.directory, ".trellis"))
  }

  // OpenCode exports no session identity into the environment: no OPENCODE_*
  // name in the 1.17.18 binary or the 1.18.13 source carries one. The plugin
  // hook input is the only source, and the `export TRELLIS_CONTEXT_ID=` prefix
  // this plugin adds to Bash commands is the only way that identity reaches a
  // child process. TRELLIS_CONTEXT_ID is honored here so a nested Trellis run
  // inherits its parent's key; do not add platform-native env names next to it
  // without evidence a vendor sets them.
  getContextKey(platformInput = null) {
    const override = stringValue(process.env.TRELLIS_CONTEXT_ID)
    if (override) {
      return sanitizeKey(override) || hashValue(override)
    }

    const input = platformInput && typeof platformInput === "object" ? platformInput : null
    if (!input) return null

    const sessionID = lookupString(input, ["session_id", "sessionId", "sessionID"])
    if (sessionID) return buildContextKey("opencode", "session", sessionID)

    const conversationID = lookupString(input, ["conversation_id", "conversationId", "conversationID"])
    if (conversationID) return buildContextKey("opencode", "conversation", conversationID)

    const transcriptPath = lookupString(input, ["transcript_path", "transcriptPath", "transcript"])
    if (transcriptPath) return buildContextKey("opencode", "transcript", transcriptPath)

    return null
  }

  readContext(contextKey) {
    try {
      const contextPath = join(this.directory, ".trellis", ".runtime", "sessions", `${contextKey}.json`)
      if (!existsSync(contextPath)) return null
      return JSON.parse(readFileSync(contextPath, "utf-8"))
    } catch {
      return null
    }
  }

  /**
   * Get active task from session runtime context.
   *
   * Resolution order (mirrors Python `active_task.resolve_active_task`):
   *   1. Lookup the runtime file for the input-derived context key.
   *   2. If that misses and exactly one session runtime file exists locally,
   *      use it (`_resolveSingleSessionFallback`). Refuses to guess when 0 or
   *      ≥2 files exist so multi-window isolation holds.
   */
  getActiveTask(platformInput = null) {
    const contextKey = this.getContextKey(platformInput)
    if (contextKey) {
      const context = this.readContext(contextKey)
      const taskRef = this.normalizeTaskRef(context?.current_task || "")
      if (taskRef) {
        const taskDir = this.resolveTaskDir(taskRef)
        return {
          taskPath: taskRef,
          source: `session:${contextKey}`,
          stale: !taskDir || !existsSync(taskDir),
        }
      }
    }

    const fallback = this._resolveSingleSessionFallback()
    if (fallback) {
      return fallback
    }

    return { taskPath: null, source: "none", stale: false }
  }

  /**
   * Mirror of Python `_resolve_single_session_fallback`. Returns the task
   * pointed at by the sole session runtime file when exactly one exists,
   * else null.
   */
  _resolveSingleSessionFallback() {
    const sessionsDir = join(this.directory, ".trellis", ".runtime", "sessions")
    if (!existsSync(sessionsDir)) return null

    let files
    try {
      files = readdirSync(sessionsDir)
        .filter(name => name.endsWith(".json"))
        .sort()
    } catch {
      return null
    }
    if (files.length !== 1) return null

    const sessionFile = join(sessionsDir, files[0])
    let context
    try {
      context = JSON.parse(readFileSync(sessionFile, "utf-8"))
    } catch {
      return null
    }
    const taskRef = this.normalizeTaskRef(context?.current_task || "")
    if (!taskRef) return null

    const taskDir = this.resolveTaskDir(taskRef)
    const fallbackKey = files[0].replace(/\.json$/, "")
    return {
      taskPath: taskRef,
      source: `session-fallback:${fallbackKey}`,
      stale: !taskDir || !existsSync(taskDir),
    }
  }

  getCurrentTask(platformInput = null) {
    return this.getActiveTask(platformInput).taskPath
  }

  normalizeTaskRef(taskRef) {
    if (!taskRef) {
      return ""
    }

    if (isAbsolute(taskRef)) {
      return taskRef.trim()
    }

    let normalized = taskRef.trim().replace(/\\/g, "/")
    while (normalized.startsWith("./")) {
      normalized = normalized.slice(2)
    }

    if (normalized.startsWith("tasks/")) {
      return `.trellis/${normalized}`
    }

    return normalized
  }

  /**
   * Return `candidate` when it lands inside the project, else null.
   *
   * A task ref is not always something the user typed. `task.py` now refuses
   * to store one that leaves the project, but a session file written before
   * that fix can still hold one, and `trellis update` does not rewrite session
   * files — so a poisoned pointer outlives the upgrade that closed the writer.
   * Both sides are resolved so a task directory symlinked outside is refused
   * too, but the original `candidate` is returned on success: callers build
   * paths relative to `this.directory`, and handing them a realpath would break
   * that whenever the project itself sits behind a symlink.
   */
  containInProject(candidate) {
    try {
      const rel = relative(realpathSync(this.directory), realpathSync(candidate))
      if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
        return null
      }
      return candidate
    } catch {
      return null
    }
  }

  resolveTaskDir(taskRef) {
    const normalized = this.normalizeTaskRef(taskRef)
    if (!normalized) {
      return null
    }

    const candidate = isAbsolute(normalized)
      ? normalized
      : normalized.startsWith(".trellis/")
        ? join(this.directory, normalized)
        : join(this.directory, ".trellis", "tasks", normalized)

    return this.containInProject(candidate)
  }

  // ============================================================
  // File Reading Utilities
  // ============================================================

  readFile(filePath) {
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, "utf-8")
      }
    } catch {
      // Ignore read errors
    }
    return null
  }

  readProjectFile(relativePath) {
    return this.readFile(join(this.directory, relativePath))
  }

  runScript(scriptPath, cwd = null, contextKey = null) {
    try {
      const result = execSync(`${PYTHON_CMD} "${scriptPath}"`, {
        cwd: cwd || this.directory,
        timeout: 10000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(contextKey ? { TRELLIS_CONTEXT_ID: contextKey } : {}),
        },
      })
      return result || ""
    } catch {
      return ""
    }
  }

  // ============================================================
  // JSONL Reading
  // ============================================================

  /**
   * Read a JSONL file and materialize referenced files/directories into
   * context blocks, applying per-file caps and the shared total budget
   * (issue #441). Mirrors Python `_materialize_jsonl_entries`.
   * Supports:
   *   {"file": "path/to/file.md", "reason": "..."}
   *   {"file": "path/to/dir/", "type": "directory", "reason": "..."}
   *
   * Missing referenced files are skipped silently (Python `_materialize_file`
   * returns None for them).
   */

}

// ============================================================
// Context Collector (for session deduplication)
// ============================================================

export { debugLog }
