# Optional Paseo adapter

This package is installed explicitly through Pennix Lifecycle. It requires Node 22 or newer
and Paseo 0.15.3. The ordinary Trellis CLI/core do not depend on it.

`trellis-paseo-adapter` accepts one version-1 JSON request on stdin and returns one bounded
JSON response. Task commands own authorization, attempts, receipts and acceptance. The
adapter uses only public SDK exports, connects to a verified running local daemon, and
never starts a service, installs a provider, archives a workspace or approves permissions.
An unknown write outcome requires native reconciliation, never automatic replay.

Paseo server dependencies include native provider/PTY/voice packages. Their installation
cost is confined to this optional package and Lifecycle's explicit script allowlist.
The supported initial matrix is Paseo SDK/daemon 0.15.3 and Codex; other providers and
remote transports are refused. Bottom-level approval/context settings use native defaults.
