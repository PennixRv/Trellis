import type { TeammateProvider } from "./profiles.js";
import { getAdapter, listProviders } from "./adapters/index.js";

export type TeammateTransport = "codex-app-server" | "acp" | "claude-cli";

export interface TeammateAdapterContract {
  provider: TeammateProvider;
  transport: TeammateTransport;
  supportsLaunch: true;
  supportsPrompt: true;
  supportsContinuation: boolean;
  supportsInterrupt: boolean;
  supportsCancel: true;
  supportsTerminal: boolean;
  supportsFailure: true;
}

export function getTeammateAdapter(
  provider: TeammateProvider,
): TeammateAdapterContract {
  return {
    provider,
    transport: getAdapter(provider).transport,
    supportsLaunch: true,
    supportsPrompt: true,
    supportsContinuation: true,
    supportsInterrupt: true,
    supportsCancel: true,
    supportsTerminal: true,
    supportsFailure: true,
  };
}

export function listTeammateProviders(): TeammateProvider[] {
  return listProviders();
}

export interface TeammateHostCapabilities {
  foregroundWait: boolean;
  protectedArtifactWrites: boolean;
  attemptArtifactWrites: boolean;
  providerTransports: TeammateTransport[];
  providerOptions: Partial<Record<TeammateProvider, string[]>>;
  verifiedHostCap: number;
}

/** Options actually consumed by the native CLI adapters. */
export const CLI_PROVIDER_OPTIONS: TeammateHostCapabilities["providerOptions"] =
  {
    codex: [],
    claude: [],
    copilot: [],
    dsh: [],
  };

export function assertTeammateProviderOptions(
  provider: TeammateProvider,
  options: Record<string, string | number | boolean> = {},
  supportedOptions: string[] = CLI_PROVIDER_OPTIONS[provider] ?? [],
): void {
  const unsupported = Object.keys(options).filter(
    (key) => !supportedOptions.includes(key),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `teammate provider '${provider}' has unsupported options: ${unsupported.join(", ")}`,
    );
  }
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
    host.attemptArtifactWrites !== true
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
  assertTeammateProviderOptions(
    provider,
    options,
    host.providerOptions[provider] ?? [],
  );
}

export function assertTeammateAdapterContract(
  provider: TeammateProvider,
): void {
  const adapter = getTeammateAdapter(provider);
  if (
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
