# Optional Paseo adapter

This package is installed explicitly through Pennix Lifecycle. It requires Node 22 or newer
and a running Paseo daemon 0.15.3 or 0.15.4. The ordinary Trellis CLI/core do not depend on it.

`trellis-paseo-adapter` accepts one version-1 JSON request on stdin and returns one bounded
JSON response. Task commands own authorization, attempts, receipts and acceptance. The
adapter uses only public SDK exports, connects to a verified running local daemon, and
never starts a service, installs a provider, archives a workspace or approves permissions.
An unknown write outcome requires native reconciliation, never automatic replay.

Paseo server dependencies include native provider/PTY/voice packages. Their installation
cost is confined to this optional package and Lifecycle's explicit script allowlist.
The supported matrix is Paseo SDK 0.15.3 with daemon 0.15.3 or 0.15.4 and Codex;
the public server-info handshake checks the daemon identity and exact version before
any operation. Missing or unknown versions, other providers and remote transports
are refused. Capability output distinguishes `sdk_version` from `daemon_version`.
Bottom-level approval/context settings use native defaults.
