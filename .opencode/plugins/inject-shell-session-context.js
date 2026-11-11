import process from "node:process"
import { TrellisContext, debugLog } from "../lib/trellis-context.js"

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function envValue(env, key) {
  const value = env?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function shellBasename(value) {
  return value.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || ""
}

function isWindowsPosixShell(env = process.env) {
  if (envValue(env, "MSYSTEM")) return true
  if (envValue(env, "MINGW_PREFIX")) return true
  if (envValue(env, "OPENCODE_GIT_BASH_PATH")) return true

  const ostype = envValue(env, "OSTYPE")?.toLowerCase() || ""
  if (/(msys|mingw|cygwin)/.test(ostype)) return true

  const shell = shellBasename(envValue(env, "SHELL") || "")
  return /^(bash|sh|zsh)(\.exe)?$/.test(shell)
}

function buildTrellisContextPrefix(contextKey, hostPlatform = process.platform, env = process.env) {
  if (hostPlatform === "win32" && !isWindowsPosixShell(env)) {
    return `$env:TRELLIS_CONTEXT_ID = ${powershellQuote(contextKey)}; `
  }

  return `export TRELLIS_CONTEXT_ID=${shellQuote(contextKey)}; `
}

function getBashCommandKey(args) {
  if (!args || typeof args !== "object") return null
  if (typeof args.command === "string") return "command"
  if (typeof args.cmd === "string") return "cmd"
  return null
}

function commandStartsWithTrellisContext(command) {
  const firstCommand = command.trimStart().split(/[;&|]/, 1)[0].trimStart()
  return (
    /^TRELLIS_CONTEXT_ID\s*=/.test(firstCommand) ||
    /^export\s+TRELLIS_CONTEXT_ID\s*=/.test(firstCommand) ||
    /^env\s+(?:(?:-\S+|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+)*TRELLIS_CONTEXT_ID\s*=/.test(firstCommand) ||
    /^\$env:TRELLIS_CONTEXT_ID\s*=/i.test(firstCommand)
  )
}

/**
 * OpenCode exposes no session identity to Bash at all — it sets no session env
 * var in any process. The plugin hook does receive it, so inject it into Bash
 * commands before execution; that prefix is the only channel by which an
 * AI-run `task.py` sees the OpenCode session.
 */
function injectTrellisContextIntoBash(ctx, input, output, hostPlatform, env) {
  const args = output?.args
  const commandKey = getBashCommandKey(args)
  if (!commandKey) return false

  const command = args[commandKey]
  if (!command.trim()) return false
  if (commandStartsWithTrellisContext(command)) return false

  const contextKey = ctx.getContextKey(input)
  if (!contextKey) return false

  args[commandKey] = `${buildTrellisContextPrefix(contextKey, hostPlatform, env)}${command}`
  return true
}


export default async ({ directory, platform: hostPlatform = process.platform, env = process.env }) => {
  const ctx = new TrellisContext(directory)
  return {
    "tool.execute.before": async (input, output) => {
      try {
        if (process.env.TRELLIS_HOOKS === "0" || process.env.TRELLIS_DISABLE_HOOKS === "1") return
        if (input?.tool?.toLowerCase() === "bash") injectTrellisContextIntoBash(ctx, input, output, hostPlatform, env)
      } catch (error) {
        debugLog("shell-context", "Session identity bridge failed:", error)
      }
    },
  }
}
