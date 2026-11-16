import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, perform, verifyDaemonInfo } from '../src/adapter.js';

const request = (operation, payload) => ({ version: 1, operation, attempt_id: 'a'.repeat(32), binding_revision: 'b'.repeat(64), daemon_selector: {}, payload });
test('admission uses the connected daemon identity and operation capabilities', async () => {
  for (const version of ['0.15.3', '0.15.4', '0.16.0', '1.0.0']) {
    const info = { serverId: 'same-host', version };
    assert.doesNotThrow(() => verifyDaemonInfo(info, 'same-host'));
    const api = { providers: { listModels: async () => ['model'], listModes: async () => ['mode'] } };
    const result = await perform(request('capability', { cwd: '/fixture' }), api, { getLastServerInfoMessage: () => info }, { server_id: 'same-host' });
    assert.equal(result.daemon_version, version);
    assert.equal(result.sdk_version, '0.15.3');
  }
  for (const version of [undefined, null, ''])
    assert.throws(() => verifyDaemonInfo({ serverId: 'same-host', version }, 'same-host'), { category: 'unsupported' });
  for (const info of [undefined, { serverId: 'other', version: '0.15.4' }])
    assert.throws(() => verifyDaemonInfo(info, 'same-host'), { category: 'identity_mismatch' });
});
test('rejects unsafe fields and malformed write input before native calls', () => {
  for (const input of [request('execute', { prompt: 'x', providerOptions: {} }), request('prepare-agent', { labels: { secret: 'x' } }), request('wait', { timeout_ms: -1 }), { ...request('execute', {}), attempt_id: 'prefix' }]) assert.throws(() => validate(input));
});
test('SDK create uses stable role, explicit settings, per-tree MCP and attempt idempotency', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'adapter-'));
  try {
    let sent;
    const snapshot = { id: 'native-full-id', workspaceId: 'workspace', cwd, status: 'initializing', activeTurn: { id: 'turn', prompt: 'private' }, runtimeInfo: { model: 'model', token: 'private' } };
    const ref = { refresh: async () => {}, current: () => snapshot };
    const api = { workspaces: { ref: () => ({ agents: { create: async (input) => { assert.equal(input.background, undefined, 'native existing-workspace creation rejects visibility intent'); sent = input; return ref; } } }) } };
    const input = request('prepare-agent', { workspace_id: 'workspace', cwd, model: 'model', effort: 'high', role: 'stable role', context: '/projection', prompt: 'prepare', codegraph: true, codegraph_command: process.execPath, labels: { 'trellis.attempt': 'attempt' } });
    const result = await perform(validate(input), api, {}, { server_id: 'same-host' });
    assert.equal(sent.config.systemPrompt, 'stable role');
    assert.equal(sent.config.provider, 'codex/model');
    assert.equal(sent.config.modeId, 'full-access');
    assert.equal(sent.config.thinkingOptionId, 'high');
    assert.deepEqual(sent.config.mcpServers.codegraph.args, ['serve', '--mcp', '--bound-worktree', cwd]);
    assert.equal(sent.config.mcpServers.codegraph.command, process.execPath, 'daemon PATH must not choose the required executable');
    await assert.rejects(perform(validate(request('prepare-agent', { ...input.payload, codegraph_command: 'codegraph' })), api, {}, {}));
    assert.equal(sent.env.TRELLIS_DELEGATION_CONTEXT, '/projection');
    assert.equal(sent.idempotencyKey.length, 64);
    const firstKey = sent.idempotencyKey;
    await perform(validate(input), api, {}, { server_id: 'same-host' });
    assert.equal(sent.idempotencyKey, firstKey);
    await perform(validate(request('prepare-agent', { ...input.payload, role: 'corrected role' })), api, {}, { server_id: 'same-host' });
    assert.notEqual(sent.idempotencyKey, firstKey, 'a corrected rejected request must not collide with the native cached fingerprint');
    assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal(sent.config.sandbox, undefined);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('native inspection includes background and archived agents for reconciliation', async () => {
  let options;
  const api = { agents: { list: async (input) => { options = input; return { entries: [{ id: 'background-agent', cwd: '/tree', labels: { 'trellis.attempt': 'attempt' } }], pageInfo: { nextCursor: null } }; } }, config: { get: async () => ({ config: { autoArchiveAfterMerge: false } }) }, projects: { list: async () => ({ projects: [] }) } };
  const result = await perform(request('inspect', {}), api, {}, {});
  assert.equal(options.includeBackground, true);
  assert.equal(options.includeArchived, true);
  assert.equal(result.agents[0].id, 'background-agent');
});
test('inspection pages more than 1000 historical agents without hiding the last writer', async () => {
  let calls = 0;
  const api = { agents: { list: async ({cursor,limit}) => {
    calls++;
    const offset = Number(cursor ?? 0), end = Math.min(offset + limit, 1301);
    return { entries: Array.from({length:end-offset}, (_,i) => ({
      id:String(offset+i), status:offset+i===1300 ? 'running' : 'closed', labels:{}
    })), pageInfo: {nextCursor:end===1301 ? null : String(end)} };
  } }, config: {get:async()=>({config:{autoArchiveAfterMerge:false}})}, projects:{list:async()=>({projects:[]})} };
  let cursor, count = 0, last;
  do {
    const result = await perform(validate(request('inspect', { page_size:100, ...(cursor ? {cursor} : {}) })), api, {}, {});
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 256*1024);
    count += result.agents.length;
    last = result.agents.at(-1);
    cursor = result.page_info.next_cursor;
    assert.equal(result.page_info.complete, cursor === null);
  } while (cursor);
  assert.equal(count, 1301);
  assert.equal(calls, 14);
  assert.equal(last.status, 'running');
});
test('exact agent inspection does not fetch unrelated history', async () => {
  const api = { agents: {ref: id => ({refresh:async()=>{}, current:()=>({id,status:'closed',labels:{}})}) },
    config:{get:async()=>({})},projects:{list:async()=>({projects:[]})} };
  const result = await perform(validate(request('inspect',{agent_id:'exact'})),api,{},{});
  assert.equal(result.agents[0].id,'exact');
  assert.equal(result.agents.length,1);
});
test('missing inspection capability, bad pagination and excessive output stay explicit failures', {timeout:2000}, async () => {
  const api = {agents:{list:async()=>({entries:[],pageInfo:{nextCursor:'repeat'}})},
    config:{get:async()=>({})},projects:{list:async()=>({projects:[]})}};
  await assert.rejects(perform(request('inspect',{}),api,{},{}), {category:'invalid_response'});
  api.agents.list = async()=>({entries:[],pageInfo:{}});
  await assert.rejects(perform(request('inspect',{}),api,{},{}), {category:'invalid_response'});
  api.agents.list = async()=>({entries:[{id:'large',labels:{x:'x'.repeat(256*1024)}}],pageInfo:{nextCursor:null}});
  await assert.rejects(perform(request('inspect',{}),api,{},{}), {category:'response_limit'});
  await assert.rejects(perform(request('inspect',{}),{}, {}, {}), {category:'unsupported'});
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
