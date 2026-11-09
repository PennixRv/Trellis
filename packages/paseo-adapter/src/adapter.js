import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';

export const MAX_BYTES = 256 * 1024;
const operations = new Set(['capability', 'inspect', 'prepare-workspace', 'prepare-agent', 'execute', 'followup', 'observe', 'wait', 'interrupt', 'resource-preview']);
export function refuse(category) { throw Object.assign(new Error(category), { category }); }
function text(value) { if (typeof value !== 'string' || !value || value.length > 65536 || value.includes('\0')) refuse('invalid_input'); return value; }
function keys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k => !allowed.includes(k))) refuse('invalid_input');
}
export function validate(request) {
  keys(request, ['version', 'operation', 'attempt_id', 'binding_revision', 'daemon_selector', 'payload']);
  if (request.version !== 1 || !operations.has(request.operation)) refuse('unsupported');
  keys(request.daemon_selector ?? {}, ['home', 'server_id']);
  if (!['capability', 'inspect', 'resource-preview'].includes(request.operation) || request.attempt_id !== undefined && request.attempt_id !== null) {
    if (!/^[a-f0-9]{32}$/.test(request.attempt_id) || !/^[a-f0-9]{64}$/.test(request.binding_revision)) refuse('invalid_input');
  }
  if (request.binding_revision != null && !/^[a-f0-9]{64}$/.test(request.binding_revision)) refuse('invalid_input');
  const fields = {
    capability: ['cwd'], inspect: ['target', 'workspace_id', 'agent_id'], 'resource-preview': ['target', 'workspace_id', 'agent_id'],
    'prepare-workspace': ['target', 'branch', 'base_commit', 'title'],
    'prepare-agent': ['workspace_id', 'cwd', 'model', 'effort', 'role', 'context', 'prompt', 'codegraph', 'codegraph_command', 'labels'],
    execute: ['agent_id', 'cwd', 'prompt', 'client_message_id'], followup: ['agent_id', 'cwd', 'prompt', 'client_message_id'],
    observe: ['agent_id', 'cwd'], wait: ['agent_id', 'cwd', 'timeout_ms'], interrupt: ['agent_id', 'cwd'],
  };
  keys(request.payload ?? {}, fields[request.operation]);
  for (const [key, value] of Object.entries(request.payload ?? {})) {
    if (key === 'codegraph') { if (typeof value !== 'boolean') refuse('invalid_input'); }
    else if (key === 'timeout_ms') { if (!Number.isInteger(value) || value < 1 || value > 3600000) refuse('invalid_input'); }
    else if (key === 'labels') { keys(value, ['trellis.control', 'trellis.child', 'trellis.attempt']); Object.values(value).forEach(text); }
    else text(value);
  }
  for (const value of Object.values(request.daemon_selector ?? {})) text(value);
  return request;
}
function projectAgent(agent) {
  if (!agent) return null;
  const result = Object.fromEntries(['id', 'workspaceId', 'cwd', 'provider', 'model', 'status', 'thinkingOptionId', 'effectiveThinkingOptionId', 'labels'].map(k => [k, agent[k] ?? null]));
  result.activeTurn = agent.activeTurn ? { id: agent.activeTurn.id ?? null } : null;
  result.runtimeInfo = agent.runtimeInfo ? Object.fromEntries(['provider', 'model', 'modeId', 'thinkingOptionId'].map(k => [k, agent.runtimeInfo[k] ?? null])) : null;
  return result;
}
function workspace(w) {
  if (!w) return null;
  return Object.fromEntries(['id', 'projectId', 'projectRootPath', 'workspaceDirectory', 'workspaceKind', 'setupStatus', 'status', 'branch'].map(k => [k, w[k] ?? null]));
}
export async function perform(request, api, client, identity) {
  const p = request.payload ?? {}, op = request.operation;
  async function agent() {
    const ref = api.agents.ref(text(p.agent_id));
    await ref.refresh();
    const current = ref.current();
    if (!current || current.id !== p.agent_id || realpathSync(current.cwd) !== realpathSync(text(p.cwd))) refuse('identity_mismatch');
    return ref;
  }
  if (op === 'capability') {
    const cwd = text(p.cwd);
    return { identity, sdk_version: '0.15.3', protocol: 1, models: await api.providers.listModels('codex', { cwd }), modes: await api.providers.listModes('codex', { cwd }) };
  }
  if (op === 'prepare-workspace') {
    const ref = await api.workspaces.create({ source: { kind: 'worktree', cwd: realpathSync(text(p.target)), action: 'branch-off', baseBranch: text(p.base_commit), branchName: text(p.branch) }, title: text(p.title), background: true });
    await ref.refresh();
    return { identity, workspace: workspace(ref.current()) };
  }
  if (op === 'prepare-agent') {
    const cwd = realpathSync(text(p.cwd));
    const config = { provider: `codex/${text(p.model)}`, thinkingOptionId: text(p.effort), modeId: 'full-access', systemPrompt: text(p.role) };
    if (p.codegraph) {
      const command = text(p.codegraph_command);
      if (!isAbsolute(command) || !statSync(command).isFile()) refuse('invalid_input');
      accessSync(command, constants.X_OK);
      // The daemon may have a narrower PATH than the controller that admitted the tool.
      config.mcpServers = { codegraph: { type: 'stdio', command, args: ['serve', '--mcp', '--bound-worktree', cwd] } };
    }
    const fingerprint = JSON.stringify({ config, cwd, context: p.context, prompt: p.prompt, labels: p.labels });
    const ref = await api.workspaces.ref(text(p.workspace_id)).agents.create({ config, env: { TRELLIS_DELEGATION_CONTEXT: text(p.context) }, prompt: text(p.prompt), labels: p.labels, idempotencyKey: createHash('sha256').update(request.attempt_id + request.binding_revision + fingerprint).digest('hex') });
    await ref.refresh();
    return { identity, agent: projectAgent(ref.current()) };
  }
  if (['execute', 'followup'].includes(op)) {
    const ref = await agent();
    if (ref.activeTurn || ref.status !== 'idle') refuse('identity_mismatch');
    await ref.send(text(p.prompt), { clientMessageId: text(p.client_message_id) });
    return { identity, send_returned: true, delivery_proven: false, agent_id: ref.id };
  }
  if (['observe', 'wait', 'interrupt'].includes(op)) {
    const ref = await agent();
    let waitStatus;
    if (op === 'wait' && ref.activeTurn) {
      if (!Number.isInteger(p.timeout_ms) || p.timeout_ms < 1 || p.timeout_ms > 3600000) refuse('invalid_input');
      waitStatus = (await ref.waitForFinish(p.timeout_ms)).status;
    }
    if (op === 'interrupt') await client.cancelAgent(ref.id);
    await ref.refresh();
    return { identity, agent: projectAgent(ref.current()), wait_status: waitStatus, writer_stop_proven: false };
  }
  const agents = [], workspaces = [];
  let cursor;
  do {
    const page = await api.agents.list({ cursor, limit: 100, includeArchived: true, includeBackground: true });
    agents.push(...page.entries.map(e => projectAgent(e.agent ?? e)));
    cursor = page.pageInfo?.nextCursor;
    if (agents.length > 1000) refuse('unsupported');
  } while (cursor);
  if (p.workspace_id) {
    const ref = api.workspaces.ref(text(p.workspace_id));
    await ref.refresh();
    workspaces.push(workspace(ref.current()));
  }
  const config = await api.config.get();
  // Only project lifecycle settings are projected. Provider env/keys never leave the client.
  const projects = await api.projects.list();
  return { identity, agents, workspaces, projects: projects.projects?.map(x => ({ id: x.projectId, path: x.projectRootPath })), lifecycle: { autoArchiveAfterMerge: config.config?.autoArchiveAfterMerge ?? null } };
}
export async function dispatch(input) {
  const request = validate(input);
  const { createHostClient } = await import('@getpaseo/client/node');
  const { createPaseoApi } = await import('@getpaseo/client');
  const { resolvePaseoHome, readDaemonInstance, waitForDaemonReady, isSameDaemonInstance, readLocalCredentialForTarget } = await import('@getpaseo/server/daemon-control');
  const home = realpathSync(request.daemon_selector?.home ?? resolvePaseoHome(process.env));
  const original = await readDaemonInstance(home);
  if (!original) refuse('unavailable');
  const instance = await waitForDaemonReady(home, { timeoutMs: 15000, instance: original });
  if (process.env.PASEO_HOST && process.env.PASEO_HOST !== instance.listen) refuse('identity_mismatch');
  if (!isSameDaemonInstance(original, instance) || instance.hostname !== hostname() || !instance.serverId || (request.daemon_selector?.server_id && request.daemon_selector.server_id !== instance.serverId)) refuse('identity_mismatch');
  const client = createHostClient(instance.listen, { clientId: `trellis-${randomUUID()}`, clientType: 'cli', appVersion: 'trellis-adapter-v1', localCredential: () => readLocalCredentialForTarget(home, instance.listen) ?? undefined, connectTimeoutMs: 15000, reconnect: { enabled: false } });
  let api;
  try {
    await client.connect();
    if (client.getLastServerInfoMessage()?.serverId !== instance.serverId || !isSameDaemonInstance(instance, await readDaemonInstance(home))) refuse('identity_mismatch');
    api = createPaseoApi(client);
    return await perform(request, api, client, { server_id: instance.serverId, home, pid: instance.pid, started_at: instance.startedAt });
  } finally { if (api) await api.dispose(); await client.close(); }
}
