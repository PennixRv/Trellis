/**
 * AI Tool Types and Registry
 *
 * Defines supported AI coding tools and which command templates they can use.
 */

/**
 * Supported AI coding tools
 */
export type AITool =
  | "claude-code"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "devin"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "dsh"
  | "pi"
  | "reasonix"
  | "zcode"
  | "trae"
  | "omp"
  | "grok"
  | "kimi"
  | "snow";

/**
 * Template directory categories
 */
export type TemplateDir =
  | "common"
  | "claude"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "devin"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "dsh"
  | "pi"
  | "reasonix"
  | "zcode"
  | "trae"
  | "omp"
  | "grok"
  | "kimi"
  | "snow";

/**
 * CLI flag names for platform selection (e.g., --claude, --cursor, --kilo, --kiro, --gemini, --antigravity)
 * Must match keys in InitOptions (src/commands/init.ts)
 */
export type CliFlag =
  | "claude"
  | "cursor"
  | "opencode"
  | "codex"
  | "kilo"
  | "kiro"
  | "gemini"
  | "antigravity"
  | "devin"
  | "qoder"
  | "codebuddy"
  | "copilot"
  | "droid"
  | "dsh"
  | "pi"
  | "reasonix"
  | "zcode"
  | "trae"
  | "omp"
  | "grok"
  | "kimi"
  | "snow";

/**
 * Template context for placeholder resolution.
 * Controls how common templates are rendered per platform.
 */
export interface TemplateContext {
  /** Prefix for cross-referencing other commands/skills */
  cmdRefPrefix:
    | "/trellis:"
    | "/trellis-"
    | "$"
    | "/"
    | "/skill trellis-"
    | "/skill:trellis-"
    | "trellis-";
  /** Label for user-invocable actions */
  userActionLabel:
    | "Slash commands"
    | "Skills"
    | "Workflows"
    | "Prompts"
    | "Commands";
  /** Platform has hook system (SessionStart, PreToolUse) */
  hasHooks: boolean;
  /**
   * CLI flag value for this platform (e.g. "claude", "codex", "kiro").
   * Substituted into template commands via {{CLI_FLAG}} so rendered skill /
   * command files can pass `--platform <flag>` to scripts that need to know
   * the invoking platform, removing the need to re-detect at runtime.
   * Duplicates the top-level `AIToolConfig.cliFlag` for convenience — the
   * invariant is maintained in `AI_TOOLS` config blocks.
   */
  cliFlag: CliFlag;
}

/**
 * Configuration for an AI tool
 */
export interface AIToolConfig {
  /** Display name of the tool */
  name: string;
  /** Command template directory names to include */
  templateDirs: TemplateDir[];
  /** Config directory name in the project root (e.g., ".claude") */
  configDir: string;
  /**
   * Whether the platform supports the shared `.agents/skills/` layer
   * (agentskills.io open standard). When true, `.agents/skills` is added
   * to the platform's managed paths automatically.
   */
  supportsAgentSkills?: boolean;
  /** Additional managed paths beyond configDir (e.g., .github/hooks for Copilot) */
  extraManagedPaths?: string[];
  /** CLI flag name for --flag options (e.g., "claude" for --claude) */
  cliFlag: CliFlag;
  /** Whether this tool is checked by default in interactive init prompt */
  defaultChecked: boolean;
  /** Whether this tool uses Python hooks (affects Windows encoding detection) */
  hasPythonHooks: boolean;
  /**
   * Optional user-global compatibility plugin for platform versions where
   * project-level integration is unavailable. Trellis may surface a manual
   * installation hint, but leaves installation and lifecycle management to
   * the platform UI.
   */
  globalHookPlugin?: {
    name: string;
    marketplaceUrl: string;
  };
  /** Template context for placeholder resolution in common templates */
  templateContext: TemplateContext;
}

/**
 * Registry of all supported AI tools and their configurations.
 * This is the single source of truth for platform data.
 *
 * When adding a new platform, add an entry here and create:
 * 1. src/configurators/{platform}.ts — configure function
 * 2. src/templates/{platform}/ — template files
 * 3. Register in src/configurators/index.ts — PLATFORM_FUNCTIONS
 * 4. Add CLI flag in src/cli/index.ts
 * 5. Add to InitOptions in src/commands/init.ts
 */
export const AI_TOOLS: Record<AITool, AIToolConfig> = {
  "claude-code": {
    name: "Claude Code",
    templateDirs: ["common", "claude"],
    configDir: ".claude",
    cliFlag: "claude",
    defaultChecked: true,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "claude",
    },
  },
  cursor: {
    name: "Cursor",
    templateDirs: ["common", "cursor"],
    configDir: ".cursor",
    cliFlag: "cursor",
    defaultChecked: true,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "cursor",
    },
  },
  opencode: {
    name: "OpenCode",
    templateDirs: ["common", "opencode"],
    configDir: ".opencode",
    cliFlag: "opencode",
    defaultChecked: false,
    // hasHooks: false — OpenCode has no session-start hook. The pre-v0.5.0
    // `.opencode/commands/trellis/start.md` deprecation in
    // migrations/manifests/0.5.0-beta.0.json assumed a hook would replace it;
    // that never happened for OpenCode, so `resolveCommands`/`filterCommands`
    // (see configurators/shared.ts) still generate `/start` as the live

    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Slash commands",
      hasHooks: false,
      cliFlag: "opencode",
    },
  },
  codex: {
    name: "Codex (also writes .agents/skills/ — read by Cursor, Gemini CLI, GitHub Copilot, Amp, Kimi Code)",
    templateDirs: ["common", "codex"],
    configDir: ".codex",
    supportsAgentSkills: true,
    cliFlag: "codex",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      userActionLabel: "Skills",
      hasHooks: false,
      cliFlag: "codex",
    },
  },
  kilo: {
    name: "Kilo CLI",
    templateDirs: ["common", "kilo"],
    configDir: ".kilocode",
    cliFlag: "kilo",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Workflows",
      hasHooks: false,
      cliFlag: "kilo",
    },
  },
  kiro: {
    name: "Kiro Code",
    templateDirs: ["common", "kiro"],
    configDir: ".kiro/skills",
    extraManagedPaths: [".kiro/agents", ".kiro/hooks"],
    cliFlag: "kiro",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      userActionLabel: "Skills",
      hasHooks: true,
      cliFlag: "kiro",
    },
  },
  gemini: {
    name: "Gemini CLI",
    templateDirs: ["common", "gemini"],
    configDir: ".gemini",
    supportsAgentSkills: true,
    cliFlag: "gemini",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "gemini",
    },
  },
  antigravity: {
    name: "Antigravity",
    templateDirs: ["common", "antigravity"],
    configDir: ".agent/workflows",
    extraManagedPaths: [".agent/skills"],
    cliFlag: "antigravity",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/",
      userActionLabel: "Workflows",
      hasHooks: false,
      cliFlag: "antigravity",
    },
  },
  devin: {
    name: "Devin",
    templateDirs: ["common", "devin"],
    configDir: ".devin/workflows",
    extraManagedPaths: [".devin/skills"],
    cliFlag: "devin",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Workflows",
      hasHooks: false,
      cliFlag: "devin",
    },
  },
  qoder: {
    name: "Qoder",
    templateDirs: ["common", "qoder"],
    configDir: ".qoder",
    cliFlag: "qoder",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "$",
      userActionLabel: "Skills",
      hasHooks: true,
      cliFlag: "qoder",
    },
  },
  codebuddy: {
    name: "CodeBuddy",
    templateDirs: ["common", "codebuddy"],
    configDir: ".codebuddy",
    cliFlag: "codebuddy",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "codebuddy",
    },
  },
  copilot: {
    name: "GitHub Copilot",
    templateDirs: ["common", "copilot"],
    configDir: ".github/copilot",
    extraManagedPaths: [
      ".github/agents",
      ".github/copilot-instructions.md",
      ".github/hooks",
      ".github/prompts",
      ".github/skills",
    ],
    cliFlag: "copilot",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/",
      userActionLabel: "Prompts",
      hasHooks: true,
      cliFlag: "copilot",
    },
  },
  droid: {
    name: "Factory Droid",
    templateDirs: ["common", "droid"],
    configDir: ".factory",
    cliFlag: "droid",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "droid",
    },
  },
  /** Main-session platform assets and native context entry points. */
  dsh: {
    name: "DeepSeek Harness (dsh)",
    templateDirs: ["common", "dsh"],
    configDir: ".dsh",
    supportsAgentSkills: true,
    cliFlag: "dsh",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "trellis-",
      userActionLabel: "Skills",
      hasHooks: false,
      cliFlag: "dsh",
    },
  },
  pi: {
    // Pi also writes .agents/skills/, which is read by Cursor, Gemini CLI,
    // GitHub Copilot, Amp, and Kimi Code. Keep that detail here rather than
    // in `name` — `name` leaks verbatim into `trellis platforms` output and
    // init checkboxes, where a long parenthetical reads badly.
    name: "Pi Agent",
    templateDirs: ["common", "pi"],
    configDir: ".pi",
    supportsAgentSkills: true,
    cliFlag: "pi",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "pi",
    },
  },
  reasonix: {
    name: "Reasonix",
    templateDirs: ["common", "reasonix"],
    configDir: ".reasonix",
    cliFlag: "reasonix",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/skill trellis-",
      userActionLabel: "Skills",
      hasHooks: false,
      cliFlag: "reasonix",
    },
  },
  zcode: {
    name: "ZCode",
    templateDirs: ["common", "zcode"],
    configDir: ".zcode",
    // `.zcode/cli/agents` is the pre-ZCode-update discovery path. Kept managed
    // during the transition so `trellis update --migrate` (rename-dir →
    // `.zcode/agents/`) and `trellis uninstall` can clean up the now-empty
    // `.zcode/cli/` parent. Drop this entry once the migration has shipped and
    // no project still holds the legacy dir. Only empty dirs are ever removed,
    // so user files are never touched (see cleanupEmptyDirs in update.ts).
    extraManagedPaths: [
      ".zcode/cli/agents",
      ".zcode/agents",
      ".zcode/commands",
      ".zcode/skills",
      // Hook implementations written by configureZcode. On ZCode builds that
      // disable project hook registration, trellis-bridge invokes them instead.
      ".zcode/hooks",
    ],
    cliFlag: "zcode",
    defaultChecked: false,
    hasPythonHooks: true,
    globalHookPlugin: {
      name: "trellis-bridge",
      marketplaceUrl: "https://github.com/CNHLAIA/ZCode-Trellis-Plugin.git",
    },
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Skills",
      // ZCode supports project hook registration through .zcode/config.json.
      // On builds that disable it, the optional global trellis-bridge plugin
      // registers the same events and delegates to the project hook scripts.

      hasHooks: true,
      cliFlag: "zcode",
    },
  },
  trae: {
    name: "Trae",
    templateDirs: ["common", "trae"],
    configDir: ".trae",
    cliFlag: "trae",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Commands",
      hasHooks: true,
      cliFlag: "trae",
    },
  },
  omp: {
    name: "Oh My Pi",
    templateDirs: ["common", "omp"],
    configDir: ".omp",
    cliFlag: "omp",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis:",
      userActionLabel: "Slash commands",
      hasHooks: true,
      cliFlag: "omp",
    },
  },
  /** Main-session platform assets and native context entry points. */
  grok: {
    name: "Grok Build",
    templateDirs: ["common", "grok"],
    configDir: ".grok",
    extraManagedPaths: [".grok/skills", ".grok/commands", ".grok/agents"],
    cliFlag: "grok",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Skills",
      hasHooks: false,
      cliFlag: "grok",
    },
  },
  /** Main-session platform assets and native context entry points. */
  kimi: {
    name: "Kimi Code",
    templateDirs: ["common", "kimi"],
    configDir: ".kimi-code",
    supportsAgentSkills: true,
    cliFlag: "kimi",
    defaultChecked: false,
    hasPythonHooks: false,
    templateContext: {
      cmdRefPrefix: "/skill:trellis-",
      userActionLabel: "Slash commands",
      hasHooks: false,
      cliFlag: "kimi",
    },
  },
  /** Main-session platform assets and native context entry points. */
  snow: {
    name: "Snow CLI",
    templateDirs: ["common", "snow"],
    configDir: ".snow/skills",
    extraManagedPaths: [
      ".snow/commands",
      ".snow/agents",
      ".snow/hooks",
      ".snow/SNOW.md",
    ],
    cliFlag: "snow",
    defaultChecked: false,
    hasPythonHooks: true,
    templateContext: {
      cmdRefPrefix: "/trellis-",
      userActionLabel: "Skills",
      hasHooks: true,
      cliFlag: "snow",
    },
  },
};

/**
 * Get the configuration for a specific AI tool
 */
export function getToolConfig(tool: AITool): AIToolConfig {
  return AI_TOOLS[tool];
}

/**
 * Get all managed paths for a specific tool.
 */
export function getManagedPaths(tool: AITool): string[] {
  const config = AI_TOOLS[tool];
  const paths = [config.configDir];
  if (config.supportsAgentSkills) {
    paths.push(".agents/skills");
  }
  if (config.extraManagedPaths) {
    paths.push(...config.extraManagedPaths);
  }
  return paths;
}

/**
 * Get template directories for a specific tool
 */
export function getTemplateDirs(tool: AITool): TemplateDir[] {
  return AI_TOOLS[tool].templateDirs;
}
