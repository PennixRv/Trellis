# Optional Paseo adapter

This package is installed explicitly through Pennix Lifecycle. It requires Node 22 or newer
and a running local Paseo daemon with the public operations used by the request. The ordinary Trellis CLI/core do not depend on it.

`trellis-paseo-adapter` accepts one version-1 JSON request on stdin and returns one bounded
JSON response. Task commands own authorization, attempts, receipts and acceptance. The
adapter uses only public SDK exports, connects to a verified running local daemon, and
never starts a service, installs a provider, archives a workspace or approves permissions.
An unknown write outcome requires native reconciliation, never automatic replay.

Paseo server dependencies include native provider/PTY/voice packages. Their installation
cost is confined to this optional package and Lifecycle's explicit script allowlist.
The packaged SDK is pinned for reproducible installation; daemon admission uses
the public server-info identity, operation methods and actual response contracts,
without a daemon version allowlist. Missing identity or required methods, other
providers and remote transports are refused. Capability output distinguishes
`sdk_version` from the informational `daemon_version`.
Bottom-level approval/context settings use native defaults.

`inspect` and `resource-preview` accept optional `page_size` (1–100) and `cursor`.
Paged replies include `page_info.next_cursor` and `page_info.complete`; consume
every page before concluding that a resource is absent. An `agent_id` uses an
exact native reference without reading unrelated history. Existing unpaged calls
still require a complete result and fail explicitly at the 256 KiB response
boundary. There is no historical-agent count limit; incomplete pages, cursor
cycles and excessive responses fail explicitly. Native controller consumers use
paging for writer checks and exact IDs or scoped paging for recovery.
