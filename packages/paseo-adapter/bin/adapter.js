#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dispatch, MAX_BYTES } from '../src/adapter.js';

if (process.argv[2] === '--version') {
  process.stdout.write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
} else {
  let request;
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new Error('request exceeds size limit');
      chunks.push(chunk);
    }
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const observations = await dispatch(request);
    const result = JSON.stringify({ version: 1, operation: request.operation, attempt_id: request.attempt_id, binding_revision: request.binding_revision, ok: true, observations });
    if (Buffer.byteLength(result) > MAX_BYTES) throw new Error('response exceeds size limit');
    process.stdout.write(result + '\n');
  } catch (error) {
    // Native messages can contain provider configuration or credentials; expose stable categories only.
    const category = error.category ?? (request && !['capability', 'inspect', 'observe', 'wait', 'resource-preview'].includes(request.operation) ? 'outcome_unknown' : request ? 'native_error' : 'invalid_input');
    process.stdout.write(JSON.stringify({ version: 1, operation: request?.operation, attempt_id: request?.attempt_id, binding_revision: request?.binding_revision, ok: false, observations: null, error: { category, message: `Paseo adapter: ${category}; inspect native state before retrying a write.` } }) + '\n');
    process.exitCode = 1;
  }
}
