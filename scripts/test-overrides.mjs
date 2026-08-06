#!/usr/bin/env node
/**
 * Test agent override (model/thinking) in all scenarios:
 * 1. Single agent, no @tag (main)
 * 2. Multiple agents, no orchestrator, @tag direct
 * 3. Orchestrator + agents, delegation
 * 4. Orchestrator + agents, @tag direct (bypass orchestrator)
 */
import WebSocket from 'ws';
import { readFileSync } from 'fs';

const WS_URL = 'ws://127.0.0.1:9182';
const DEBUG_LOG = process.env.HOME + '/.quinki/quinki-debug.log';
const TIMEOUT = 60000;

let nextId = 1;
let ws;
let pending = new Map();
let notifications = [];

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (!msg.id) {
        // Notification (streaming events, etc.)
        notifications.push(msg);
      }
    });
  });
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout calling ${method}`));
      }
    }, TIMEOUT);
  });
}

function waitForDone(sessionKey) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'done' && msg.sessionKey === sessionKey) {
        ws.off('message', handler);
        resolve(msg);
      }
      if (msg.type === 'error' && msg.sessionKey === sessionKey) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.off('message', handler); resolve(null); }, TIMEOUT);
  });
}

function getAgentLlmConfigs() {
  const lines = readFileSync(DEBUG_LOG, 'utf8').split('\n');
  const configs = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.tag === 'agent_llm_config') {
        configs.push(entry.data);
      }
    } catch {}
  }
  return configs;
}

async function test() {
  console.log('=== Connecting to sidecar ===');
  await connect();
  console.log('Connected ✅\n');

  // Get available models
  const state = await call('getFullState', {});
  const providers = state.providers || [];
  const allModels = providers.flatMap(p => (p.models || []).map(m => ({ id: m.id, provider: p.name })));
  console.log('Available models:', allModels.map(m => m.id).join(', '));

  // Pick test models
  const modelA = allModels.find(m => m.id.includes('glm'))?.id || allModels[0]?.id;
  const modelB = allModels.find(m => m.id.includes('minimax'))?.id || allModels[1]?.id || modelA;
  console.log('Using modelA:', modelA, 'modelB:', modelB);

  const configsBefore = getAgentLlmConfigs().length;
  console.log('Existing agent_llm_config entries:', configsBefore, '\n');

  // ============================================================
  // TEST 1: Single agent, no @tag (main session)
  // ============================================================
  console.log('━━━ TEST 1: Single agent, no @tag (main) ━━━');
  {
    const r = await call('createSession', { label: 'Test 1 single agent' });
    const sk = r.key || r.sessionKey;
    await call('setModel', { sessionKey: sk, model: modelA });
    await call('setThinking', { sessionKey: sk, thinkingLevel: 'xhigh' });
    await call('sendMessage', { sessionKey: sk, text: 'ciao' });
    await waitForDone(sk);
    console.log('  Session:', sk);
    console.log('  Expected: source=main, model=' + modelA + ', thinking=xhigh');
  }

  // ============================================================
  // TEST 2: Multiple agents, no orchestrator, @tag direct
  // ============================================================
  console.log('\n━━━ TEST 2: Multiple agents, no orchestrator, @tag direct ━━━');
  {
    const r = await call('createSession', { label: 'Test 2 @tag direct' });
    const sk = r.key || r.sessionKey;
    await call('setModel', { sessionKey: sk, model: modelA });
    await call('setThinking', { sessionKey: sk, thinkingLevel: 'xhigh' });
    // Set agents (notion + web-researcher, no orchestrator)
    await call('setChatAgents', { sessionKey: sk, agentIds: 'notion,web-researcher' });
    // Set per-agent override for notion
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'off' });
    // Send with @notion (direct)
    await call('sendMessage', { sessionKey: sk, text: '@notion ciao', agentId: 'notion' });
    await waitForDone(sk);
    console.log('  Session:', sk);
    console.log('  Expected: source=direct, agent=notion, model=' + modelB + ', thinking=off');
  }

  // ============================================================
  // TEST 3: Orchestrator + agents, delegation
  // ============================================================
  console.log('\n━━━ TEST 3: Orchestrator + agents, delegation ━━━');
  {
    const r = await call('createSession', { label: 'Test 3 delegation' });
    const sk = r.key || r.sessionKey;
    await call('setModel', { sessionKey: sk, model: modelA });
    await call('setThinking', { sessionKey: sk, thinkingLevel: 'xhigh' });
    // Set orchestrator + agents
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,notion,web-researcher,frontend-designer' });
    // Set per-agent overrides
    await call('setAgentOverride', { sessionKey: sk, agentId: 'notion', model: modelB, thinkingLevel: 'on' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'web-researcher', model: modelA, thinkingLevel: 'on' });
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    // Send to orchestrator (it will delegate)
    await call('sendMessage', { sessionKey: sk, text: 'Saluta tutti gli agenti per me. Delega a ognuno.' });
    await waitForDone(sk);
    console.log('  Session:', sk);
    console.log('  Expected: source=main (orchestrator) + source=delegation for each agent');
    console.log('  notion: model=' + modelB + ', thinking=xhigh (on→xhigh)');
    console.log('  web-researcher: model=' + modelA + ', thinking=xhigh (on→xhigh)');
    console.log('  frontend-designer: model=' + modelB + ', thinking=off');
  }

  // ============================================================
  // TEST 4: Orchestrator + agents, @tag direct (bypass orchestrator)
  // ============================================================
  console.log('\n━━━ TEST 4: Orchestrator + agents, @tag direct ━━━');
  {
    const r = await call('createSession', { label: 'Test 4 @tag with orchestrator' });
    const sk = r.key || r.sessionKey;
    await call('setModel', { sessionKey: sk, model: modelA });
    await call('setThinking', { sessionKey: sk, thinkingLevel: 'xhigh' });
    // Set orchestrator + agents
    await call('setChatAgents', { sessionKey: sk, agentIds: 'orchestrator,notion,frontend-designer' });
    // Set per-agent override for frontend-designer
    await call('setAgentOverride', { sessionKey: sk, agentId: 'frontend-designer', model: modelB, thinkingLevel: 'off' });
    // Send with @frontend-designer (direct, bypassing orchestrator)
    await call('sendMessage', { sessionKey: sk, text: '@frontend-designer ciao', agentId: 'frontend-designer' });
    await waitForDone(sk);
    console.log('  Session:', sk);
    console.log('  Expected: source=direct, agent=frontend-designer, model=' + modelB + ', thinking=off');
  }

  // ============================================================
  // Collect and print results
  // ============================================================
  console.log('\n\n═══════ RESULTS ═══════\n');
  const allConfigs = getAgentLlmConfigs();
  const newConfigs = allConfigs.slice(configsBefore);

  for (const cfg of newConfigs) {
    const sourceLabel = cfg.source === 'main' ? 'MAIN' : cfg.source === 'direct' ? 'DIRECT' : 'DELEGATION';
    const thinkingLabel = cfg.agentOverrideThinking === 'on' ? `On (${cfg.thinkingLevel})` 
      : cfg.agentOverrideThinking === 'off' ? 'Off' 
      : 'Chat default';
    const modelOverrideLabel = cfg.agentOverrideModel || 'Chat default';
    
    console.log(`[${sourceLabel}] ${cfg.agentName} (${cfg.agentId})`);
    console.log(`  Model: ${cfg.model} | Override: ${modelOverrideLabel}`);
    console.log(`  Thinking: ${cfg.thinkingLevel} | Override: ${thinkingLabel}`);
    console.log('');
  }

  ws.close();
  console.log('=== Tests complete ===');
}

test().catch(e => { console.error('Test failed:', e.message); process.exit(1); });