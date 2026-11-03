import type { TeammateProvider } from "./profiles.js";

export type TeammateTransport = "codex-app-server" | "acp" | "claude-cli";

export interface TeammateAdapterContract {
  provider: TeammateProvider;
  transport: TeammateTransport;
  nativeDelegationDisabled: true;
  supportsLaunch: true;
  supportsPrompt: true;
  supportsContinuation: boolean;
  supportsInterrupt: boolean;
  supportsCancel: true;
  supportsTerminal: boolean;
  supportsFailure: true;
}

const ADAPTERS: Record<TeammateProvider, TeammateAdapterContract> = {
  codex: {
    provider: "codex",
    transport: "codex-app-server",
    nativeDelegationDisabled: true,
    supportsLaunch: true,
    supportsPrompt: true,
    supportsContinuation: true,
    supportsInterrupt: true,
    supportsCancel: true,
    supportsTerminal: true,
    supportsFailure: true,
  },
  dsh: {
    provider: "dsh",
    transport: "acp",
    nativeDelegationDisabled: true,
    supportsLaunch: true,
    supportsPrompt: true,
    supportsContinuation: true,
    supportsInterrupt: true,
    supportsCancel: true,
    supportsTerminal: true,
    supportsFailure: true,
  },
  copilot: {
    provider: "copilot",
    transport: "acp",
    nativeDelegationDisabled: true,
    supportsLaunch: true,
    supportsPrompt: true,
    supportsContinuation: true,
    supportsInterrupt: true,
    supportsCancel: true,
    supportsTerminal: true,
    supportsFailure: true,
  },
  claude: {
    provider: "claude",
    transport: "claude-cli",
    nativeDelegationDisabled: true,
    supportsLaunch: true,
    supportsPrompt: true,
    supportsContinuation: true,
    supportsInterrupt: true,
    supportsCancel: true,
    supportsTerminal: true,
    supportsFailure: true,
  },
};

export function getTeammateAdapter(
  provider: TeammateProvider,
): TeammateAdapterContract {
  return ADAPTERS[provider];
}

export function listTeammateProviders(): TeammateProvider[] {
  return Object.keys(ADAPTERS) as TeammateProvider[];
}

export interface TeammateHostCapabilities {
  foregroundWait: boolean;
  protectedArtifactWrites: boolean;
  attemptArtifactWrites: boolean;
  nativeDelegationDisabled: boolean;
  implicitMemoryDisabled: boolean;
  providerTransports: TeammateTransport[];
  providerOptions: Partial<Record<TeammateProvider, string[]>>;
  verifiedHostCap: number;
}

export function assertTeammateHostCapability(
  provider: TeammateProvider,
  host: TeammateHostCapabilities,
  options: Record<string, string | number | boolean> = {},
): void {
  const adapter = getTeammateAdapter(provider);
  if (
    host.foregroundWait !== true ||
    host.protectedArtifactWrites !== true ||
    host.attemptArtifactWrites !== true ||
    host.nativeDelegationDisabled !== true ||
    host.implicitMemoryDisabled !== true
  ) {
    throw new Error(
      "teammate host capability proof is incomplete; refusing batch dispatch",
    );
  }
  if (!Number.isInteger(host.verifiedHostCap) || host.verifiedHostCap <= 0) {
    throw new Error(
      "teammate host capability proof has no positive verified host cap",
    );
  }
  if (!host.providerTransports.includes(adapter.transport)) {
    throw new Error(
      `teammate provider '${provider}' transport is not verified by the host`,
    );
  }
  if (!adapter.nativeDelegationDisabled) {
    throw new Error(
      `teammate provider '${provider}' does not disable native delegation`,
    );
  }
  const supportedOptions = host.providerOptions[provider] ?? [];
  const unsupportedOptions = Object.keys(options).filter(
    (key) => !supportedOptions.includes(key),
  );
  if (unsupportedOptions.length > 0) {
    throw new Error(
      `teammate provider '${provider}' has unsupported options: ${unsupportedOptions.join(", ")}`,
    );
  }
}

export function assertTeammateAdapterContract(
  provider: TeammateProvider,
): void {
  const adapter = getTeammateAdapter(provider);
  if (
    !adapter.nativeDelegationDisabled ||
    !adapter.supportsLaunch ||
    !adapter.supportsPrompt ||
    !adapter.supportsContinuation ||
    !adapter.supportsInterrupt ||
    !adapter.supportsCancel ||
    !adapter.supportsTerminal ||
    !adapter.supportsFailure
  ) {
    throw new Error(
      `teammate provider '${provider}' has an incomplete lifecycle contract`,
    );
  }
}
