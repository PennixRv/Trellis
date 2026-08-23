# Design: Response-Gated Codex App Server Handshake

## Boundary

This task changes only the Codex provider's channel handshake and its direct
tests and contract documentation. `supervisor.ts` remains responsible for
starting the stdout pump and turning a thrown handshake error into a durable
channel error followed by shutdown. The root audit owns the later fresh-host
capability sentinel and any conclusion about worker tools.

## State And Data Flow

```text
spawned child + stdout parser
  -> write initialize request with response waiter
  -> matching successful response
  -> write initialized notification (no id)
  -> write thread/start request with response waiter
  -> matching successful response with thread id
  -> ready
```

`CodexCtx.pending` remains the response-label registry used for channel event
classification. `CodexCtx.responseWaiters` is a bounded, request-id keyed
handshake-only registry. `parseCodexLine` resolves or rejects the registered
waiter while retaining its existing `thread/start` thread-id projection. The
handshake wrapper also rejects the same outstanding request if the child exits
or emits an error before its response.

## Failure Contract

| Condition | Required outcome |
| --- | --- |
| `initialize` JSON-RPC error, malformed result, timeout, exit, or child error | reject; do not send `initialized` or `thread/start`; no ready state |
| `thread/start` JSON-RPC error, timeout, exit, or child error | reject; no ready state |
| `thread/start` result lacks a usable thread id | reject; no ready state |
| Any terminal waiter outcome | remove its `pending` and waiter entries; clear its timeout; detach process listeners |
| Late or duplicate response | preserve existing parser behavior; it cannot make the adapter ready without a valid thread id |

## Compatibility And Tradeoffs

Waiting for the initialization response is stricter than a fixed delay and
keeps ordering deterministic under slow startup. The current minimum
`capabilities: {}` payload remains unchanged; this task does not infer that any
experimental capability is needed for worker tools. A response waiter is used
instead of polling `threadId`, so readiness has one causal source: the matching
successful response.

## Test Design

Use an in-memory writable/readable child double. Capture each JSON line written
to stdin, feed precise response lines through the production parser, and use
fake timers only to advance the bounded response timeout. Each negative test
must prove that deleting the gated condition would fail the assertion, rather
than merely observing an eventual rejection.

## Rollback

The change is a single, narrow component commit. Reverting it restores the
previous adapter implementation, but does not change the root audit state or
claim that the worker capability issue is resolved.
