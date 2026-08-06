#!/usr/bin/env node
const WebSocket = require('/Users/andreamaddalena/Projects/Quinki/sidecar-src/node_modules/ws');
const { readFileSync } = require('fs');

const WS_URL = 'ws://127.0.0.1:9182';
const DEBUG_LOG = process.env.HOME + '/.quinki/quinki-debug.log';
const RPC_TIMEOUT = 300000; // 5 min for delegation tests
const modelA = 'glm-5.2:cloud';
const modelB = 'minimax-m3:cloud';

let nextId = 1, ws, pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error))); else res(msg.result);
      }
    });
  });
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, RPC_TIMEOUT);
  });
}
function getConfigs() {
  return readFileSync(DEBUG_LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e?.tag === 'agent_llm_config').map(e => e.data);
}

async function test() {
  console.log('=== Connecting ===');
  await connect();
  console.log('Connected ✅\n');
  const before = getConfigs().length;

  // TEST 1: Single agent, no @tag (main)
  console.log('━━━ TEST 1: Single agent (main) ━━━');
  try {
    const r = await call('createSession', { label: 'T1', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('sendMessage', { sessionKey: sk, text: 'ciao' });
    console.log('  ✅ Done. Expected: MAIN, model=' + modelA + ', thinking=xhigh, override=Chat default');
  } catch(e) { console.log('  ❌ ' + e.message); }

  // TEST 2: Two agents, no orchestrator, @tag direct
  console.log('\n━━━ TEST 2: @tag direct (no orchestrator) ━━━');
  try {
    const r = await call('createSession', { label: 'T2', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'notion,web-researcher' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: '@notion ciao', agentId: 'notion' });
    console.log('  ✅ Done. Expected: MAIN, agent=notion, model=' + modelB + ', thinking=off, override=Off');
  } catch(e) { console.log('  ❌ ' + e.message); }

  // TEST 3: Orchestrator + 2 agents, delegation
  console.log('\n━━━ TEST 3: Orchestrator delegation ━━━');
  try {
    const r = await call('createSession', { label: 'T3', model: modelA, thinkingLevel: 'medium' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,notion,frontend-designer' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'on' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: 'Delega a notion e frontend-designer dicendo ciao.' });
    console.log('  ✅ Done.');
    console.log('    Expected MAIN: orchestrator, model=' + modelA + ', thinking=medium');
    console.log('    Expected DELEGATION notion: model=' + modelB + ', thinking=medium (On→medium)');
    console.log('    Expected DELEGATION frontend-designer: model=' + modelB + ', thinking=off (Off)');
  } catch(e) { console.log('  ❌ ' + e.message); }

  // TEST 4: Orchestrator + agents, @tag direct
  console.log('\n━━━ TEST 4: @tag direct (with orchestrator) ━━━');
  try {
    const r = await call('createSession', { label: 'T4', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,frontend-designer' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: '@frontend-designer ciao', agentId: 'frontend-designer' });
    console.log('  ✅ Done. Expected: MAIN, agent=frontend-designer, model=' + modelB + ', thinking=off, override=Off');
  } catch(e) { console.log('  ❌ ' + e.message); }

  // RESULTS
  console.log('\n\n═══════ RESULTS ═══════\n');
  const all = getConfigs();
  const newCfgs = all.slice(before);
  for (const c of newCfgs) {
    const src = c.source === 'main' ? 'MAIN' : c.source === 'direct' ? 'DIRECT' : 'DELEGATION';
    const tOv = c.agentOverrideThinking === 'on' ? `On (${c.thinkingLevel})` : c.agentOverrideThinking === 'off' ? 'Off' : 'Chat default';
    const mOv = c.agentOverrideModel || 'Chat default';
    console.log(`[${src}] ${c.agentName}`);
    console.log(`  Model: ${c.model} | Override: ${mOv}`);
    console.log(`  Thinking: ${c.thinkingLevel} | Override: ${tOv}\n`);
  }
  ws.close();
  console.log('=== Done ===');
}
test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });