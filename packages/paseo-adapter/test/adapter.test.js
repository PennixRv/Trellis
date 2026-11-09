import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, perform } from '../src/adapter.js';

const request = (operation, payload) => ({ version: 1, operation, attempt_id: 'a'.repeat(32), binding_revision: 'b'.repeat(64), daemon_selector: {}, payload });
test('rejects unsafe fields and malformed write input before native calls', () => {
  for (const input of [request('execute', { prompt: 'x', providerOptions: {} }), request('prepare-agent', { labels: { secret: 'x' } }), request('wait', { timeout_ms: -1 }), { ...request('execute', {}), attempt_id: 'prefix' }]) assert.throws(() => validate(input));
});
test('SDK create uses stable role, explicit settings, per-tree MCP and attempt idempotency', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'adapter-'));
  try {
    let sent;
    const snapshot = { id: 'native-full-id', workspaceId: 'workspace', cwd, status: 'initializing', activeTurn: { id: 'turn', prompt: 'private' }, runtimeInfo: { model: 'model', token: 'private' } };
    const ref = { refresh: async () => {}, current: () => snapshot };
    const api = { workspaces: { ref: () => ({ agents: { create: async (input) => { sent = input; return ref; } } }) } };
    const input = request('prepare-agent', { workspace_id: 'workspace', cwd, model: 'model', effort: 'high', role: 'stable role', context: '/projection', prompt: 'prepare', codegraph: true, labels: { 'trellis.attempt': 'attempt' } });
    const result = await perform(validate(input), api, {}, { server_id: 'same-host' });
    assert.equal(sent.config.systemPrompt, 'stable role');
    assert.equal(sent.config.provider, 'codex/model');
    assert.equal(sent.config.modeId, 'full-access');
    assert.equal(sent.config.thinkingOptionId, 'high');
    assert.deepEqual(sent.config.mcpServers.codegraph.args, ['serve', '--mcp', '--bound-worktree', cwd]);
    assert.equal(sent.env.TRELLIS_DELEGATION_CONTEXT, '/projection');
    assert.equal(sent.idempotencyKey.length, 64);
    assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal(sent.config.sandbox, undefined);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('unknown cwd never sends, native cancellation never claims writer stop', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'adapter-'));
  try {
    let sent = false, cancelled = false;
    const ref = { id: 'agent', status: 'idle', refresh: async () => {}, current: () => ({ id: 'agent', cwd, status: 'idle' }), send: async () => { sent = true; } };
    const api = { agents: { ref: () => ref } };
    await assert.rejects(perform(request('execute', { agent_id: 'wrong-id', cwd, prompt: 'execute', client_message_id: 'message' }), api, {}, {}));
    assert.equal(sent, false);
    const result = await perform(request('interrupt', { agent_id: 'agent', cwd }), api, { cancelAgent: async () => { cancelled = true; } }, {});
    assert.equal(cancelled, true);
    assert.equal(result.writer_stop_proven, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
