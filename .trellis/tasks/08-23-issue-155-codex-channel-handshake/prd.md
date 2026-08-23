# Issue 155: Codex channel handshake remediation

## Goal

Make the Trellis Codex channel adapter start a worker thread only after the
Codex App Server initialization handshake has been acknowledged. This is a
protocol-compatibility repair and a prerequisite for a later capability
sentinel; it does not assert that the handshake is the root cause of the
separate worker-tool availability failure.

## Confirmed Facts

- At baseline `fd4bb6480cffa32c7c3a05042da0ee8b351a5e8c`, the adapter sent
  `initialize`, slept for a fixed interval, and then sent `thread/start`
  without an `initialized` notification or an initialization response gate.
- The [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
  requires one `initialize` request per connection, followed by an
  `initialized` notification, before any other request. Requests sent before
  that handshake receive `Not initialized`.
- `supervisor.ts` begins parsing worker stdout before `adapter.handshake`, and
  `parseCodexLine` owns both outgoing-response classification and the
  `thread/start` thread-id projection.
- The working tree already contains uncommitted candidate changes in the
  adapter, its unit test, and the channel contract. They are evidence to
  review, not accepted work and must not be overwritten without verification.

## Requirements

1. Send exactly one `initialize` request and wait for its matching successful
   JSON-RPC response before sending `initialized` or `thread/start`.
2. Send `initialized` as an id-less JSON-RPC notification on the same
   connection, then send `thread/start` and wait for its matching response.
3. On initialization error, malformed initialization result, timeout, child
   exit, or child error, fail the handshake without sending `thread/start` and
   without reporting the adapter ready.
4. Preserve the existing response parser, supervisor shutdown behavior, and
   thread-id projection. A successful `thread/start` response remains the only
   way for `isReady` to become true.
5. Keep response waiters bounded and cleaned up for success, JSON-RPC error,
   timeout, process exit, and process error. Do not leave a pending id or timer
   after a terminal handshake outcome.
6. Add deterministic unit coverage using a controlled child-process double;
   tests must not depend on real-time sleeps, a real Codex process, user
   configuration, or network access.
7. Do not expand app-server capabilities, sandbox permissions, MCP access,
   native Codex agents, or any worker privilege as a workaround.

## Acceptance Criteria

- [x] Tests assert the exact outbound sequence: `initialize` request,
      successful response, id-less `initialized` notification, then
      `thread/start` request.
- [x] Initialization error, invalid result, timeout, child exit, and child
      error prove that no `thread/start` request is emitted.
- [x] `thread/start` error, timeout, and malformed success result leave no
      thread id and make `isReady(ctx)` false; success creates the expected id.
- [x] Targeted adapter tests, CLI lint, typecheck, build, and full test suite
      pass using the repository's supported package-manager entry point.
- [x] GitNexus impact is recorded before any symbol edit, and
      `detect_changes` is run against `main` before the component commit.
- [x] The channel code-spec records the strict ordering, cleanup, and failure
      behavior, and all changed task/spec documents pass structural checks.
- [x] The component commit contains only this task's adapter, test, and
      contract changes. Package publication and installation remain subject to
      the repository's CI-only release process and separate runtime acceptance.

## Out Of Scope

- Diagnosing or closing the root audit's `R2-BLOCK-01` worker-capability
  finding.
- Starting a new worker batch, changing provider selection, or enabling native
  Codex multi-agent features.
- Publishing a package from a development shell, changing release credentials,
  or installing an unpublished build.
