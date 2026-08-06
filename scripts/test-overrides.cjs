#!/usr/bin/env node
const WebSocket = require('/Users/andreamaddalena/Projects/Quinki/sidecar-src/node_modules/ws');
const { readFileSync } = require('fs');

const WS_URL = 'ws://127.0.0.1:9182';
const DEBUG_LOG = process.env.HOME + '/.quinki/quinki-debug.log';
const TIMEOUT = 180000;
const modelA = 'glm-5.2:cloud';
const modelB = 'minimax-m3:cloud';

let nextId = 1, ws, pending = new Map(), doneCbs = [];

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
      } else if (!msg.id) {
        for (const cb of doneCbs) if (cb.matches(msg)) cb.resolve(msg);
      }
    });
  });
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, TIMEOUT);
  });
}
function waitForDone(sk) {
  return new Promise((resolve) => {
    const cb = { matches: (m) => (m.type === 'done' || m.type === 'error') && m.sessionKey === sk, resolve };
    doneCbs.push(cb);
    setTimeout(() => { const i = doneCbs.indexOf(cb); if (i >= 0) doneCbs.splice(i, 1); resolve(null); }, TIMEOUT);
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
  {
    const r = await call('createSession', { label: 'T1', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('sendMessage', { sessionKey: sk, text: 'ciao' });
    await waitForDone(sk);
    console.log('  Expected: MAIN, model=' + modelA + ', thinking=xhigh, override=Chat default');
  }

  // TEST 2: Two agents, no orchestrator, @tag direct
  console.log('\n━━━ TEST 2: @tag direct (no orchestrator) ━━━');
  {
    const r = await call('createSession', { label: 'T2', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'notion,web-researcher' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: '@notion ciao', agentId: 'notion' });
    await waitForDone(sk);
    console.log('  Expected: MAIN, agent=notion, model=' + modelB + ', thinking=off, override=Off');
  }

  // TEST 3: Orchestrator + 2 agents, delegation (simpler)
  console.log('\n━━━ TEST 3: Orchestrator delegation ━━━');
  {
    const r = await call('createSession', { label: 'T3', model: modelA, thinkingLevel: 'medium' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,notion,frontend-designer' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'on' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: 'Delega a notion e frontend-designer dicendo ciao a ognuno.' });
    await waitForDone(sk);
    console.log('  Expected:');
    console.log('    MAIN orchestrator: model=' + modelA + ', thinking=medium');
    console.log('    DELEGATION notion: model=' + modelB + ', thinking=medium (On→medium)');
    console.log('    DELEGATION frontend-designer: model=' + modelB + ', thinking=off (Off)');
  }

  // TEST 4: Orchestrator + agents, @tag direct
  console.log('\n━━━ TEST 4: @tag direct (with orchestrator) ━━━');
  {
    const r = await call('createSession', { label: 'T4', model: modelA, thinkingLevel: 'xhigh' });
    const sk = r.key || r.sessionKey;
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,frontend-designer' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    await call('sendMessage', { sessionKey: sk, text: '@frontend-designer ciao', agentId: 'frontend-designer' });
    await waitForDone(sk);
    console.log('  Expected: MAIN, agent=frontend-designer, model=' + modelB + ', thinking=off, override=Off');
  }

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