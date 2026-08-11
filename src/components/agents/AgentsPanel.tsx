import React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Archive, BookOpen, Bot, ChevronDown, ChevronUp, Copy, FileText, Home, Info, Package, Palette, Pencil, Plug, Plus, Power, Save, Search, Settings, Shield, Trash, Wrench, X } from '../icons'

// ============================================================
// AgentsPanel — full rewrite with sidecar wiring
// ============================================================

export function AgentsPanel(props) {
  const { call } = useSidecarContext();
  const { agents, refreshAgents, onSelectPanel } = props;

  // --- State ---
  const [skills, setSkills] = useState([]);
  const [tools, setTools] = useState([]);
  const [planModeTools, setPlanModeTools] = useState({}); // { toolName: true/false }
  const [planModeMcp, setPlanModeMcp] = useState({}); // { mcpId: true/false }
  const [expandedAgentId, setExpandedAgentId] = useState(null);
  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const [searchAgents, setSearchAgents] = useState('');
  const [searchSkills, setSearchSkills] = useState('');
  const [searchTools, setSearchTools] = useState('');
  const [expandedSkillName, setExpandedSkillName] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Modals
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [showInstallSkill, setShowInstallSkill] = useState(false);
  const [deleteAgentName, setDeleteAgentName] = useState(null);
  const [removeAllState, setRemoveAllState] = useState(null);
  const [toolDisableConfirm, setToolDisableConfirm] = useState(null); // { type, agentName }
  const [removeTagState, setRemoveTagState] = useState(null); // { type, name, agent }
  const [addItemsModal, setAddItemsModal] = useState(null); // { title, items, onConfirm }
  const [mcpServers, setMcpServers] = useState([]);
  const [expandedMcpId, setExpandedMcpId] = useState(null);
  const [searchMcp, setSearchMcp] = useState('');
  const [mcpInstallModal, setMcpInstallModal] = useState(null); // { mode: 'create'|'install' }
  const [fileEditor, setFileEditor] = useState(null); // { agentId, fileName } or { skillName, fileName }
  const [addFileAgent, setAddFileAgent] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [errorModal, setErrorModal] = useState(null);

  // --- Load skills, tools, global config on mount ---
  useEffect(() => {
    if (!call) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await call('listSkills', {});
        if (!cancelled && res?.skills) {
          setSkills(res.skills.map(s => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })));
        }
      } catch (e) { console.error('Failed to load skills:', e); }
      try {
        const res = await call('listTools', {});
        if (!cancelled && res?.tools) {
          setTools(res.tools.map(t => ({ name: t.name, description: t.description || '', readOnly: t.readOnly || false })));
        }
      } catch (e) { console.error('Failed to load tools:', e); }
      try {
        const res = await call('getGlobalConfig', {});
        if (!cancelled && res?.config?.planModeTools) {
          setPlanModeTools(res.config.planModeTools);
        }
        if (!cancelled && res?.config?.planModeMcp) {
          setPlanModeMcp(res.config.planModeMcp);
        }
      } catch (e) { console.error('Failed to load global config:', e); }
      try {
        const res = await call('listMcpServers', {});
        if (!cancelled && res?.servers) setMcpServers(res.servers);
      } catch (e) { console.error('Failed to load mcp servers:', e); }
    })();
    return () => { cancelled = true; };
  }, [call]);

  // --- No toasts in header — only dirty/saved indicator ---
  const onSaved = useCallback(() => {
    setDirty(false);
    setSavedMsg('Saved.');
    setTimeout(() => setSavedMsg(null), 4000);
  }, []);

  // --- Agent CRUD ---

  const doCreateAgent = async (name) => {
    if (!call || !name?.trim()) return;
    try {
      await call('createAgent', { name: name.trim() });
      await refreshAgents();
      setShowNewAgent(false);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doDeleteAgent = async (agentName) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call) return;
    try {
      await call('deleteAgent', { id: agent.id });
      await refreshAgents();
      setDeleteAgentName(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRenameAgent = async (agent, newName) => {
    if (!call || !newName?.trim() || newName === agent.name) { setRenamingAgentId(null); return; }
    try {
      await call('updateAgent', { id: agent.id, config: { name: newName.trim() } });
      await refreshAgents();
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
    setRenamingAgentId(null);
  };

  // --- Add/remove skills/tools from agent ---

  const doAddSkillsToAgent = async (agentId, skillNames) => {
    if (!call) return;
    const agent = agents.find(a => a.id === agentId);
    const existing = (agent?.skills||[]).map(s => typeof s === 'string' ? s : s.name) || [];
    const merged = [...new Set([...existing, ...skillNames])];
    try {
      await call('updateAgent', { id: agentId, config: { skills: merged } });
      await refreshAgents();
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doAddToolsToAgent = async (agentId, toolNames) => {
    if (!call) return;
    const agent = agents.find(a => a.id === agentId);
    const existing = (agent?.tools||[]).map(t => typeof t === 'string' ? t : t.name) || [];
    const merged = [...new Set([...existing, ...toolNames])];
    try {
      await call('updateAgent', { id: agentId, config: { tools: merged } });
      await refreshAgents();
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveSkillFromAgent = async (agentName, skillName) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call) return;
    const updated = (agent.skills||[]).map(s => typeof s === 'string' ? s : s.name).filter(s => s !== skillName);
    try {
      await call('updateAgent', { id: agent.id, config: { skills: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveToolFromAgent = async (agentName, toolName) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call) return;
    const updated = (agent.tools||[]).map(t => typeof t === 'string' ? t : t.name).filter(t => t !== toolName);
    try {
      await call('updateAgent', { id: agent.id, config: { tools: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doAddMcpToAgent = async (agentId, mcpIds) => {
    if (!call) return;
    const agent = agents.find(a => a.id === agentId);
    const existing = (agent?.mcpServers || []).map(x => x);
    const merged = [...new Set([...existing, ...mcpIds])];
    try {
      const res = await call('updateAgent', { id: agentId, config: { mcpServers: merged } });
      if (res?.success === false) { setErrorModal(res.error || 'updateAgent failed'); return; }
      const lst = await call('listMcpServers', {});
      if (lst?.servers) setMcpServers(lst.servers);
      await refreshAgents();
      setDirty(true);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveMcpFromAgent = async (agentName, mcpId) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call) return;
    const updated = (agent.mcpServers || []).filter(x => x !== mcpId);
    try {
      await call('updateAgent', { id: agent.id, config: { mcpServers: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doAddAgentsToMcp = async (mcpId, agentNames) => {
    if (!call) return;
    for (const agent of agents) {
      if (agentNames.includes(agent.name)) {
        const existing = agent.mcpServers || [];
        if (!existing.includes(mcpId)) {
          try {
            const res = await call('updateAgent', { id: agent.id, config: { mcpServers: [...existing, mcpId] } });
            if (res?.success === false) { setErrorModal(res.error || 'updateAgent failed'); return;
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000); }
          } catch (e) { setErrorModal(e.message || String(e)); return; }
        }
      }
    }
    const lst = await call('listMcpServers', {});
    if (lst?.servers) setMcpServers(lst.servers);
    await refreshAgents();
    setAddItemsModal(null);
    setDirty(true);
  };

  const doRemoveAgentFromMcp = async (mcpId, agentName) => {
    if (!call) return;
    const agent = agents.find(a => a.name === agentName);
    if (!agent) return;
    const updated = (agent.mcpServers || []).filter(x => x !== mcpId);
    try {
      await call('updateAgent', { id: agent.id, config: { mcpServers: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveAllAgentsFromMcp = async (mcpId) => {
    if (!call) return;
    for (const agent of agents) {
      if ((agent.mcpServers || []).includes(mcpId)) {
        const updated = (agent.mcpServers || []).filter(x => x !== mcpId);
        try { await call('updateAgent', { id: agent.id, config: { mcpServers: updated } }); } catch (e) { console.error(e); }
      }
    }
    await refreshAgents();
    setRemoveAllState(null);
    setDirty(true);
  };

  const doDeleteMcp = async (mcpId) => {
    if (!call) return;
    try {
      await call('removeMcpServer', { id: mcpId });
      setRemoveTagState(null);
      const res = await call('listMcpServers', {});
      if (res?.servers) setMcpServers(res.servers);
      await refreshAgents();
      setDirty(true);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveAllFromAgent = async (type, agentName) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call) return;
    try {
      if (type === 'skills') {
        await call('updateAgent', { id: agent.id, config: { skills: [] } });
      } else if (type === 'tools') {
        await call('updateAgent', { id: agent.id, config: { tools: [] } });
      } else if (type === 'files') {
        // Files: just refresh (files are on disk, would need separate delete)
        // For now just close the modal
      } else if (type === 'mcp') {
        await call('updateAgent', { id: agent.id, config: { mcpServers: [] } });
      }
      await refreshAgents();
      setRemoveAllState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  // --- File management ---

  const doCreateFile = async (agentName, fileName) => {
    const agent = agents.find(a => a.name === agentName);
    if (!agent || !call || !fileName?.trim()) return;
    try {
      const res = await call('createAgentFile', { id: agent.id, fileName: fileName.trim() });
      if (res?.success === false) {
        setErrorModal(res.error || 'Failed to create file');
      } else {
        await refreshAgents();
        setAddFileAgent(null);
        // Open the file editor
        setFileEditor({ agentId: agent.id, fileName: fileName.trim() });
        setDirty(true);
      }
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveFileFromAgent = async (agentName, fileName) => {
    // For now, we just remove it from the UI by not showing it
    // Actual file deletion from disk would need a sidecar method
    const agent = agents.find(a => a.name === agentName);
    if (!agent) return;
    setRemoveTagState(null);
    setDirty(true);
  };

  // --- Skill CRUD ---

  const doCreateSkill = async (name, description, content) => {
    if (!call || !name?.trim()) return;
    try {
      const res = await call('createSkill', { name: name.trim(), description: description || '', content: content || '' });
      if (res?.success === false) {
        setErrorModal(res.error || 'Failed to create skill');
        return;
      }
      // Refresh skills
      const skillsRes = await call('listSkills', {});
      if (skillsRes?.skills) setSkills(skillsRes.skills.map(s => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })));
      setShowCreateSkill(false);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doInstallSkill = async (pkg) => {
    if (!call || !pkg?.trim()) return;
    setInstalling(true);
    try {
      const res = await call('installSkill', { package: pkg.trim() });
      if (res?.success === false) {
        setInstalling(false);
        setErrorModal(res.error || 'Failed to install skill');
        return;
      }
      // Refresh skills
      const skillsRes = await call('listSkills', {});
      if (skillsRes?.skills) setSkills(skillsRes.skills.map(s => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })));
      setInstalling(false);
      setShowInstallSkill(false);
      setDirty(true);
    } catch (e) { setInstalling(false); setErrorModal(e.message || String(e)); }
  };

  const doDeleteSkill = async (skillName) => {
    if (!call || !skillName) return;
    try {
      const res = await call('deleteSkill', { name: skillName });
      if (res?.success === false) {
        setErrorModal(res.error || 'Failed to delete skill');
        return;
      }
      // Refresh skills + agents (deleteSkill also removes from agent configs)
      const skillsRes = await call('listSkills', {});
      if (skillsRes?.skills) setSkills(skillsRes.skills.map(s => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })));
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  // --- Plan mode tools ---

  const doTogglePlanModeTool = async (toolName, enable) => {
    if (!call) return;
    if (!enable) {
      // Show confirmation when disabling a tool
      setToolDisableConfirm(toolName);
      return;
    }
    const updated = { ...planModeTools, [toolName]: enable };
    setPlanModeTools(updated);
    try {
      const cfgRes = await call('getGlobalConfig', {});
      const cfg = cfgRes?.config || {};
      cfg.planModeTools = updated;
      await call('updateGlobalConfig', { config: cfg });
    } catch (e) { console.error('Failed to update plan mode tools:', e); }
  };

  const doConfirmToolDisable = async () => {
    if (!call || !toolDisableConfirm) return;
    const toolName = toolDisableConfirm;
    const updated = { ...planModeTools, [toolName]: false };
    setPlanModeTools(updated);
    try {
      const cfgRes = await call('getGlobalConfig', {});
      const cfg = cfgRes?.config || {};
      cfg.planModeTools = updated;
      await call('updateGlobalConfig', { config: cfg });
    } catch (e) { console.error('Failed to update plan mode tools:', e); }
    setToolDisableConfirm(null);
  };

  // --- Plan mode MCP ---
  const doTogglePlanModeMcp = async (id, enable) => {
    if (!call) return;
    const updated = { ...planModeMcp, [id]: enable };
    setPlanModeMcp(updated);
    try {
      const cfgRes = await call('getGlobalConfig', {});
      const cfg = cfgRes?.config || {};
      cfg.planModeMcp = updated;
      await call('updateGlobalConfig', { config: cfg });
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) { console.error('Failed to update plan mode mcp:', e); }
  };

  const doEnablePlanModeMcp = async (ids) => {
    if (!call) return;
    const updated = { ...planModeMcp };
    for (const id of ids) updated[id] = true;
    setPlanModeMcp(updated);
    try {
      const cfgRes = await call('getGlobalConfig', {});
      const cfg = cfgRes?.config || {};
      cfg.planModeMcp = updated;
      await call('updateGlobalConfig', { config: cfg });
    } catch (e) { console.error('Failed to update plan mode mcp:', e); }
  };

  // --- Add/remove agent from skill (reverse direction) ---

  const doAddAgentsToSkill = async (skillName, agentNames) => {
    if (!call) return;
    // ONLY ADD — never remove. Removal is done via the X button on each agent.
    for (const agent of agents) {
      if (agentNames.includes(agent.name)) {
        const existing = (agent.skills||[]).map(s => typeof s === 'string' ? s : s.name);
        if (!existing.includes(skillName)) {
          try { await call('updateAgent', { id: agent.id, config: { skills: [...existing, skillName] } }); } catch (e) { console.error(e); }
        }
      }
    }
    await refreshAgents();
    setAddItemsModal(null);
    setDirty(true);
  };

  const doRemoveAgentFromSkill = async (skillName, agentName) => {
    if (!call) return;
    const agent = agents.find(a => a.name === agentName);
    if (!agent) return;
    const updated = (agent.skills||[]).map(s => typeof s === 'string' ? s : s.name).filter(s => s !== skillName);
    try {
      await call('updateAgent', { id: agent.id, config: { skills: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveAllAgentsFromSkill = async (skillName) => {
    if (!call) return;
    const usingAgents = agents.filter(a => a.skills.some(s => s.name === skillName));
    for (const agent of usingAgents) {
      const updated = (agent.skills||[]).map(s => typeof s === 'string' ? s : s.name).filter(s => s !== skillName);
      try { await call('updateAgent', { id: agent.id, config: { skills: updated } }); } catch (e) { console.error(e); }
    }
    await refreshAgents();
    setRemoveAllState(null);
    setDirty(true);
  };

  // --- Add/remove agent from tool (reverse direction) ---

  const doAddAgentsToTool = async (toolName, agentNames) => {
    if (!call) return;
    // ONLY ADD — never remove. Removal is done via the X button on each agent.
    for (const agent of agents) {
      if (agentNames.includes(agent.name)) {
        const existing = (agent.tools||[]).map(t => typeof t === 'string' ? t : t.name);
        if (!existing.includes(toolName)) {
          try { await call('updateAgent', { id: agent.id, config: { tools: [...existing, toolName] } }); } catch (e) { console.error(e); }
        }
      }
    }
    await refreshAgents();
    setAddItemsModal(null);
    setDirty(true);
  };

  const doRemoveAgentFromTool = async (toolName, agentName) => {
    if (!call) return;
    const agent = agents.find(a => a.name === agentName);
    if (!agent) return;
    const updated = (agent.tools||[]).map(t => typeof t === 'string' ? t : t.name).filter(t => t !== toolName);
    try {
      await call('updateAgent', { id: agent.id, config: { tools: updated } });
      await refreshAgents();
      setRemoveTagState(null);
      setDirty(true);
    } catch (e) { setErrorModal(e.message || String(e)); }
  };

  const doRemoveAllAgentsFromTool = async (toolName) => {
    if (!call) return;
    const usingAgents = agents.filter(a => a.tools.some(t => t.name === toolName));
    for (const agent of usingAgents) {
      const updated = (agent.tools||[]).map(t => typeof t === 'string' ? t : t.name).filter(t => t !== toolName);
      try { await call('updateAgent', { id: agent.id, config: { tools: updated } }); } catch (e) { console.error(e); }
    }
    await refreshAgents();
    setRemoveAllState(null);
    setDirty(true);
  };

  // --- Enable tool in plan mode ---
  const doEnablePlanModeTool = async (toolNames) => {
    if (!call) return;
    const updated = { ...planModeTools };
    for (const tn of toolNames) updated[tn] = true;
    setPlanModeTools(updated);
    try {
      const cfgRes = await call('getGlobalConfig', {});
      const cfg = cfgRes?.config || {};
      cfg.planModeTools = updated;
      await call('updateGlobalConfig', { config: cfg });
    } catch (e) { console.error(e); }
    setAddItemsModal(null);
    setDirty(true);
  };

  // --- Derived data ---
  const filteredAgents = agents.filter(a => a.name.toLowerCase().includes(searchAgents.toLowerCase()));
  const filteredMcp = mcpServers.filter(m => m.name.toLowerCase().includes(searchMcp.toLowerCase()) || m.source.toLowerCase().includes(searchMcp.toLowerCase()));
  const filteredSkills = skills.filter(s => s.name.toLowerCase().includes(searchSkills.toLowerCase()) || s.description.toLowerCase().includes(searchSkills.toLowerCase()));
  const filteredTools = tools.filter(t => t.name.toLowerCase().includes(searchTools.toLowerCase()));

  // --- Render ---
  const headerStyle = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center'
  };

  return React.createElement('div', { className: 'h-full flex flex-col', children: [
    // Container
    React.createElement('div', { className: 'flex flex-col', style: { maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', flex: 1, minHeight: 0 }, children: [
      // Header
      React.createElement('div', { style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }, children: [
        // Home button
        React.createElement('div', { style: headerStyle, children: 
          React.createElement(IconButton, { icon: Home, onClick: () => onSelectPanel('home'), title: 'Home' })
        }),
        React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
        // Title bar
        React.createElement('div', { style: { ...headerStyle, flex: 1 }, children: [
          React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
          React.createElement(Bot, { size: 18, style: { color: 'var(--q-accent-secondary)', flexShrink: 0 } }),
          React.createElement('div', { style: { width: '16px', flexShrink: 0 } }),
          React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: 'Agents' }),
          React.createElement('span', { style: { flex: 1 } }),
          // Saved indicator (auto-saved, no button needed)
          savedMsg
            ? React.createElement('span', { style: { color: 'var(--q-accent-success)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: savedMsg })
            : null,
          savedMsg && React.createElement('div', { style: { width: '16px', flexShrink: 0 } }),
        ]})
      ]}),

      // Scrollable content
      React.createElement('div', { className: 'q-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 0 16px', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }, children: [

        // === Section: Your agents ===
        Section({ icon: Bot, title: `Your agents (${agents.length})`, children: [
          AddButton({ label: 'New agent', onClick: () => setShowNewAgent(true) }),
          React.createElement('div', { style: { height: '8px' } }),
          SearchBar({ placeholder: 'Search agents...', value: searchAgents, onChange: setSearchAgents }),
          React.createElement('div', { style: { height: '8px' } }),
          React.createElement('div', { style: { maxHeight: '500px', overflowY: 'auto' }, children:
            filteredAgents.map(agent => React.createElement(AgentRow, {
              key: agent.id,
              agent,
              isExpanded: expandedAgentId === agent.id,
              isRenaming: renamingAgentId === agent.id,
              onToggle: () => setExpandedAgentId(expandedAgentId === agent.id ? null : agent.id),
              onStartRename: () => setRenamingAgentId(agent.id),
              onCommitRename: (newName) => doRenameAgent(agent, newName),
              skills,
              tools,
              onShowDelete: () => setDeleteAgentName(agent.name),
              onAddFile: () => setAddFileAgent(agent.name),
              onAddSkill: () => setAddItemsModal({ title: `Add skill to ${agent.name}`, items: skills.map(s => ({ name: s.name, description: s.description })), initialSelected: (agent.skills||[]).map(s=>s.name||s), onConfirm: (selected) => doAddSkillsToAgent(agent.id, selected) }),
              onAddTool: () => setAddItemsModal({ title: `Add tool to ${agent.name}`, items: tools.map(t => ({ name: t.name, description: t.description })), initialSelected: (agent.tools||[]).map(t=>t.name||t), onConfirm: (selected) => doAddToolsToAgent(agent.id, selected) }),
              mcpServers,
              onAddMcp: () => setAddItemsModal({ title: `Add MCP to ${agent.name}`, items: mcpServers.map(s => ({ name: s.name, description: s.description || s.source })), initialSelected: (agent.mcpServers || []).map(id => { const s = mcpServers.find(x => x.id === id); return s ? s.name : null; }).filter(Boolean), onConfirm: (selected) => doAddMcpToAgent(agent.id, selected.map(n => { const s = mcpServers.find(x => x.name === n); return s ? s.id : n; }).filter(Boolean)) }),
              onOpenFile: (fileName) => setFileEditor({ agentId: agent.id, fileName }),
              onRemoveTag: (type, name) => setRemoveTagState({ type, name, agent: agent.name }),
              onRemoveAll: (type) => setRemoveAllState({ type, agentName: agent.name })
            }))
          })
        ]}),

        // === Section: Installed resources ===
        Section({ icon: Package, title: 'Installed resources', children: [

          // Skills subsection
          SubSection({ icon: BookOpen, title: `Skill (${skills.length})`, action: React.createElement(React.Fragment, { children: [
            MiniButton({ label: 'Create skill', onClick: () => setShowCreateSkill(true) }),
            MiniButton({ label: 'Install skill', onClick: () => setShowInstallSkill(true) })
          ]}), children: [
            SearchBar({ placeholder: 'Search skill...', value: searchSkills, onChange: setSearchSkills }),
            React.createElement('div', { style: { height: '8px' } }),
            React.createElement('div', { style: { maxHeight: '300px', overflowY: 'auto' }, children:
              filteredSkills.length === 0
                ? React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'No skill found.' })
                : filteredSkills.map(skill => {
                    const usingAgents = agents.filter(a => a.skills.some(s => s.name === skill.name));
                    return React.createElement(SkillRow, {
                      key: skill.name,
                      icon: BookOpen,
                      name: skill.name,
                      description: skill.description,
                      agentsUsing: usingAgents.map(a => a.name),
                      isExpanded: expandedSkillName === skill.name,
                      onToggle: () => setExpandedSkillName(expandedSkillName === skill.name ? null : skill.name),
                      onEdit: () => setFileEditor({ skillName: skill.name, fileName: 'SKILL.md' }),
                      onDeleteSkill: skill.name === 'app-expert' ? null : () => setRemoveTagState({ type: 'skill', name: skill.name, agent: '' }),
                      onAddAgent: () => setAddItemsModal({ title: `Add agent to ${skill.name}`, items: agents.map(a => ({ name: a.name, description: a.systemPrompt ? a.systemPrompt.substring(0, 80) + (a.systemPrompt.length > 80 ? '...' : '') : a.id })), initialSelected: agents.filter(a => (a.skills||[]).some(s => (s.name||s) === skill.name)).map(a => a.name), onConfirm: (selected) => doAddAgentsToSkill(skill.name, selected) }),
                      onRemoveAgent: (agentName) => setRemoveTagState({ type: 'agent', name: agentName, agent: skill.name }),
                      onRemoveAllAgents: () => setRemoveAllState({ type: 'agents', agentName: skill.name })
                    });
                  })
            })
          ]}),

          React.createElement('div', { style: { height: '8px' } }),

          // MCP subsection
          SubSection({ icon: Plug, title: `MCP (${mcpServers.length})`, action: MiniButton({ label: 'Install MCP', onClick: () => setMcpInstallModal({}) }), children: [
            SearchBar({ placeholder: 'Search MCP...', value: searchMcp, onChange: setSearchMcp }),
            React.createElement('div', { style: { height: '8px' } }),
            React.createElement('div', { style: { maxHeight: '300px', overflowY: 'auto' }, children:
              filteredMcp.length === 0
                ? React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'No MCP server installed.' })
                : filteredMcp.map(mcp => {
                    const usingAgents = agents.filter(a => (a.mcpServers || []).includes(mcp.id));
                    return React.createElement(McpRow, {
                      key: mcp.id,
                      mcp,
                      agentsUsing: usingAgents.map(a => a.name),
                      isExpanded: expandedMcpId === mcp.id,
                      onToggle: () => setExpandedMcpId(expandedMcpId === mcp.id ? null : mcp.id),
                      onAddAgent: () => setAddItemsModal({ title: `Add agent to ${mcp.name}`, items: agents.map(a => ({ name: a.name, description: a.systemPrompt ? a.systemPrompt.substring(0, 80) + (a.systemPrompt.length > 80 ? '...' : '') : a.id })), initialSelected: agents.filter(a => (a.mcpServers || []).includes(mcp.id)).map(a => a.name), onConfirm: (selected) => doAddAgentsToMcp(mcp.id, selected) }),
                      onRemoveAgent: (agentName) => setRemoveTagState({ type: 'mcp-agent', name: agentName, agent: mcp.name }),
                      onRemoveAllAgents: () => doRemoveAllAgentsFromMcp(mcp.id),
                      onDeleteMcp: () => setRemoveTagState({ type: 'mcp-server', name: mcp.id, agent: mcp.name })
                    });
                  })
            })
          ]}),

          React.createElement('div', { style: { height: '8px' } }),

          // Tools subsection
          SubSection({ icon: Wrench, title: `Tool (${tools.length})`, children: [
            SearchBar({ placeholder: 'Search tool...', value: searchTools, onChange: setSearchTools }),
            React.createElement('div', { style: { height: '8px' } }),
            React.createElement('div', { style: { maxHeight: '300px', overflowY: 'auto' }, children:
              filteredTools.map(tool => {
                const usingAgents = agents.filter(a => a.tools.some(t => t.name === tool.name));
                return React.createElement(SkillRow, {
                  key: tool.name,
                  icon: Wrench,
                  name: tool.name,
                  description: tool.description,
                  agentsUsing: usingAgents.map(a => a.name),
                  badge: tool.readOnly ? 'read' : 'write',
                  badgeColor: tool.readOnly ? 'var(--q-accent-success)' : 'var(--q-accent-danger)',
                  isExpanded: expandedSkillName === tool.name,
                  onToggle: () => setExpandedSkillName(expandedSkillName === tool.name ? null : tool.name),
                  onAddAgent: () => setAddItemsModal({ title: `Add agent to ${tool.name}`, items: agents.map(a => ({ name: a.name, description: a.systemPrompt ? a.systemPrompt.substring(0, 80) + (a.systemPrompt.length > 80 ? '...' : '') : a.id })), initialSelected: agents.filter(a => (a.tools||[]).some(t => (t.name||t) === tool.name)).map(a => a.name), onConfirm: (selected) => doAddAgentsToTool(tool.name, selected) }),
                  onRemoveAgent: (agentName) => setRemoveTagState({ type: 'agent', name: agentName, agent: tool.name }),
                  onRemoveAllAgents: () => setRemoveAllState({ type: 'agents', agentName: tool.name })
                });
              })
            })
          ]})
        ]}),

        // === Section: Plan mode ===
        Section({ icon: Shield, title: 'Plan mode', children: [
          React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }, children: 'Tools enabled in Plan mode. Applies to all agents.' }),
          React.createElement('div', { style: { height: '8px' } }),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }, children: [
            ...Object.entries(planModeTools).filter(([, v]) => v).map(([name]) =>
              TagChip({ icon: Wrench, label: name, onRemove: () => doTogglePlanModeTool(name, false) })
            ),
            MiniButton({ label: 'Add tool', onClick: () => setAddItemsModal({ title: 'Enable tool in Plan mode', items: tools.filter(t => !planModeTools[t.name]).map(t => ({ name: t.name, description: t.description })), onConfirm: (selected) => doEnablePlanModeTool(selected) }) })
          ]}),
          React.createElement('div', { style: { height: '8px' } }),
          React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }, children: 'MCP servers enabled in Plan mode. Applies to all agents.' }),
          React.createElement('div', { style: { height: '8px' } }),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }, children: [
            ...Object.entries(planModeMcp).filter(([, v]) => v).map(([id]) => {
              const s = mcpServers.find(x => x.id === id);
              return TagChip({ key: id, icon: Plug, label: s ? s.name : id, onRemove: () => doTogglePlanModeMcp(id, false) });
            }),
            MiniButton({ label: 'Add MCP', onClick: () => setAddItemsModal({ title: 'Enable MCP in Plan mode', items: mcpServers.filter(s => !planModeMcp[s.id]).map(s => ({ name: s.name, description: s.description || s.source })), onConfirm: (selected) => doEnablePlanModeMcp(selected.map(n => { const s = mcpServers.find(x => x.name === n); return s ? s.id : n; }).filter(Boolean)) }) })
          ]})
        ]}),

        React.createElement('div', { style: { height: '32px' } })
      ]})
    ]}),

    // === Modals ===

    // New agent
    showNewAgent && Modal({ onClose: () => setShowNewAgent(false), title: 'New agent', children: [
      React.createElement(NewAgentForm, { onCreate: doCreateAgent, onCancel: () => setShowNewAgent(false) })
    ]}),

    // Create skill
    showCreateSkill && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setShowCreateSkill(false), children:
      React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '520px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }, onClick: e => e.stopPropagation(), children: [
        React.createElement('div', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '16px' }, children: 'Create new skill' }),
        React.createElement(CreateSkillForm, { onCreate: doCreateSkill, onCancel: () => setShowCreateSkill(false) })
      ]})
    }),

    // Install skill
    showInstallSkill && Modal({ onClose: () => setShowInstallSkill(false), title: 'Install skill from internet', children: [
      React.createElement(InstallSkillForm, { onInstall: doInstallSkill, onCancel: () => setShowInstallSkill(false) })
    ]}),

    // Installing spinner
    installing && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children:
      React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', display: 'flex', alignItems: 'center', gap: '16px' }, children: [
        React.createElement('div', { style: { width: '20px', height: '20px', border: '2px solid var(--q-text-tertiary)', borderTopColor: 'var(--q-accent-secondary)', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: 'Installing skill...' })
      ]})
    }),

    // Delete agent confirm
    deleteAgentName && Modal({ onClose: () => setDeleteAgentName(null), title: 'Delete agent', children: [
      React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }, children: [`Delete "${deleteAgentName}"?`] }),
      ConfirmButtons({ onCancel: () => setDeleteAgentName(null), onConfirm: () => doDeleteAgent(deleteAgentName), confirmLabel: 'Delete', danger: true })
    ]}),

    // Remove all confirm
    // Tool disable confirmation
    toolDisableConfirm && Modal({ onClose: () => setToolDisableConfirm(null), title: 'Disable tool?', children: [
      React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }, children: 'Are you sure you want to disable "' + toolDisableConfirm + '" in plan mode?' }),
      React.createElement(ConfirmButtons, { onCancel: () => setToolDisableConfirm(null), onConfirm: doConfirmToolDisable, confirmLabel: 'Disable', danger: true })
    ]}),
    removeAllState && Modal({ onClose: () => setRemoveAllState(null), title: `Remove all ${removeAllState.type}`, children: [
      React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }, children: [
        removeAllState.type === 'agents'
          ? `Remove all agents from "${removeAllState.agentName}"?`
          : `Remove all ${removeAllState.type} from agent "${removeAllState.agentName}"?`
      ]}),
      ConfirmButtons({ onCancel: () => setRemoveAllState(null), onConfirm: () => {
        if (removeAllState.type === 'agents') {
          // Remove all agents from a skill/tool
          // Determine if it's a skill or tool based on context
          const skill = skills.find(s => s.name === removeAllState.agentName);
          const tool = tools.find(t => t.name === removeAllState.agentName);
          if (skill) doRemoveAllAgentsFromSkill(removeAllState.agentName);
          else if (tool) doRemoveAllAgentsFromTool(removeAllState.agentName);
          else setRemoveAllState(null);
        } else {
          doRemoveAllFromAgent(removeAllState.type, removeAllState.agentName);
        }
      }, confirmLabel: 'Remove all', danger: true })
    ]}),

    // Remove single tag confirm
    removeTagState && Modal({ onClose: () => setRemoveTagState(null), title: removeTagState.type === 'mcp-server' ? 'Uninstall MCP server' : `Remove ${removeTagState.type}`, children: [
      React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }, children: [
        removeTagState.type === 'skill'
          ? `Delete skill "${removeTagState.name}"? This removes it from all agents.`
          : removeTagState.type === 'mcp-server'
            ? `Delete MCP server "${removeTagState.name}"? It will be uninstalled and removed from all agents.`
            : removeTagState.type === 'agent'
              ? `Remove "${removeTagState.name}" from "${removeTagState.agent}"?`
              : removeTagState.type === 'mcp-agent'
                ? `Remove "${removeTagState.name}" from MCP server "${removeTagState.agent}"?`
                : `Remove ${removeTagState.type} "${removeTagState.name}" from agent "${removeTagState.agent}"?`
      ]}),
      ConfirmButtons({ onCancel: () => setRemoveTagState(null), onConfirm: () => {
        if (removeTagState.type === 'skill' && removeTagState.agent === '') {
          doDeleteSkill(removeTagState.name);
        } else if (removeTagState.type === 'skill') {
          doRemoveSkillFromAgent(removeTagState.agent, removeTagState.name);
        } else if (removeTagState.type === 'tool') {
          doRemoveToolFromAgent(removeTagState.agent, removeTagState.name);
        } else if (removeTagState.type === 'agent') {
          // Remove agent from skill/tool
          const skill = skills.find(s => s.name === removeTagState.agent);
          const tool = tools.find(t => t.name === removeTagState.agent);
          if (skill) doRemoveAgentFromSkill(removeTagState.agent, removeTagState.name);
          else if (tool) doRemoveAgentFromTool(removeTagState.agent, removeTagState.name);
          else setRemoveTagState(null);
        } else if (removeTagState.type === 'file') {
          doRemoveFileFromAgent(removeTagState.agent, removeTagState.name);
        } else if (removeTagState.type === 'mcp') {
          doRemoveMcpFromAgent(removeTagState.agent, removeTagState.name);
        } else if (removeTagState.type === 'mcp-server') {
          doDeleteMcp(removeTagState.name);
        } else if (removeTagState.type === 'mcp-agent') {
          const mm = mcpServers.find(x => x.name === removeTagState.agent);
          doRemoveAgentFromMcp(mm ? mm.id : removeTagState.agent, removeTagState.name);
        } else {
          setRemoveTagState(null);
        }
      }, confirmLabel: removeTagState.type === 'mcp-server' ? 'Uninstall' : 'Remove', danger: true })
    ]}),

    // Add items modal
    addItemsModal && React.createElement(AddItemsModal, { title: addItemsModal.title, items: addItemsModal.items, initialSelected: addItemsModal.initialSelected || [], onClose: () => setAddItemsModal(null), onConfirm: (selected) => { addItemsModal.onConfirm(selected); setAddItemsModal(null); } }),

    mcpInstallModal && React.createElement(McpInstallModal, { onClose: () => setMcpInstallModal(null), onInstalled: (list) => { setMcpServers(list); setDirty(true); } }),

    // File editor
    fileEditor && React.createElement(FileEditor, { 
      agentId: fileEditor.agentId, 
      skillName: fileEditor.skillName,
      fileName: fileEditor.fileName, 
      onClose: () => setFileEditor(null) 
    }),

    // Add file modal
    addFileAgent && Modal({ onClose: () => setAddFileAgent(null), title: 'New file', children: [
      React.createElement(NewFileForm, { onCreate: (fileName) => doCreateFile(addFileAgent, fileName), onCancel: () => setAddFileAgent(null) })
    ]}),

    // Error modal
    errorModal && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setErrorModal(null), children:
      React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '500px', width: '90%' }, onClick: e => e.stopPropagation(), children: [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }, children: [
          React.createElement('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--q-accent-danger)', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round', children: [
            React.createElement('circle', { cx: '12', cy: '12', r: '10' }),
            React.createElement('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
            React.createElement('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' })
          ]}),
          React.createElement('span', { style: { color: 'var(--q-accent-danger)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: 'Error' })
        ]}),
        React.createElement('div', { style: { maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' }, children:
          React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }, children: errorModal })
        }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }, children: [
          React.createElement('button', { onClick: () => { navigator.clipboard.writeText(errorModal); }, className: 'q-hover-btn', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', transition: 'none' }, children: [React.createElement(Copy, { size: 16 }), ' Copy'] }),
          React.createElement('button', { onClick: () => setErrorModal(null), onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: 'Close' })
        ]})
      ]})
    })
  ]});
}

// ============================================================
// Sub-components
// ============================================================

function Section({ icon, title, children }) {
  return React.createElement('div', { style: { width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }, children: [
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
      React.createElement(icon, { size: 16, style: { color: 'var(--q-accent-secondary)', flexShrink: 0 } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: title })
    ]}),
    children
  ]});
}

function SubSection({ icon, title, action, children }) {
  return React.createElement('div', { style: { width: '100%', padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }, children: [
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
      icon ? React.createElement(icon, { size: 16, style: { color: 'var(--q-tab-accent)', flexShrink: 0 } }) : null,
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: title }),
      action
    ]}),
    children
  ]});
}

function SearchBar({ placeholder, value, onChange }) {
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }, children: [
    React.createElement(Search, { size: 16, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }),
    React.createElement('input', { type: 'text', placeholder, value, onChange: e => onChange(e.target.value), style: { flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' } }),
    value && React.createElement('button', { onClick: () => onChange(''), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '14px' }, children: '✕' })
  ]});
}

function AddButton({ label, onClick }) {
  return React.createElement('button', { onClick, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent' }, children: [
    React.createElement(Plus, { size: 16, style: { color: 'var(--q-text-secondary)' } }),
    React.createElement('span', { style: { color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: label })
  ]});
}

export function MiniButton({ label, onClick }) {
  return React.createElement('button', { onClick, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent' }, children: [
    React.createElement(Plus, { size: 14, style: { color: 'var(--q-text-tertiary)' } }),
    React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: label })
  ]});
}

export function TagChip({ icon, label, onRemove }) {
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: '6px', border: 'none', backgroundColor: 'rgba(255, 255, 255, 0.04)' }, children: [
    React.createElement(icon, { size: 14, style: { color: 'var(--q-tab-accent)' } }),
    React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: label }),
    onRemove && React.createElement('button', { onClick: onRemove, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }, children: React.createElement(X, { size: 14, style: { color: 'var(--q-text-tertiary)' } }) })
  ]});
}

export function AgentRow({ agent, isExpanded, isRenaming, onToggle, onStartRename, onCommitRename, skills, tools, mcpServers, onShowDelete, onAddFile, onAddSkill, onAddTool, onAddMcp, onOpenFile, onRemoveTag, onRemoveAll, hideHeader, hideDelete }) {
  const nm = (x: any) => typeof x === 'string' ? x : (x && x.name != null ? x.name : x);
  const agentSkills = skills.filter(s => (agent.skills || []).some(as => nm(as) === s.name));
  const agentTools = tools.filter(t => (agent.tools || []).some(at => nm(at) === t.name));
  const agentMcps = (mcpServers || []).filter(s => (agent.mcpServers || []).some(id => id === s.id));
  const canRename = agent.id !== 'app-expert' && agent.id !== 'orchestrator';
  const renameRef = useRef(null);

  return React.createElement('div', { style: { marginBottom: '4px', backgroundColor: 'var(--q-bg-elevated)', border: 'none', borderRadius: '8px', overflow: 'hidden' }, children: [
    !hideHeader &&
    React.createElement('div', { onClick: onToggle, style: { padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '8px', transition: 'none' }, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(201, 112, 132, 0.03)'; }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }, children: [
      React.createElement(Bot, { size: 16, style: { color: 'var(--q-accent-secondary)', flexShrink: 0 } }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      isRenaming
        ? React.createElement('input', { type: 'text', defaultValue: agent.name, autoFocus: true, onBlur: e => onCommitRename(e.target.value), onKeyDown: e => { if (e.key === 'Enter') onCommitRename(e.target.value); }, onClick: e => e.stopPropagation(), style: { flex: 1, color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)', backgroundColor: 'transparent', border: 'none', outline: 'none', padding: '0' } })
        : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }, children: [
            React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: agent.name }),
            canRename && React.createElement('button', { onClick: e => { e.stopPropagation(); onStartRename(); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', flexShrink: 0 }, children: React.createElement(Pencil, { size: 13, style: { color: 'var(--q-text-tertiary)' } }) })
          ]}),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 }, children: [agentSkills.length, ' skill · ', agentTools.length, ' tool · ', agentMcps.length, ' mcp'] }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      isExpanded ? React.createElement(ChevronUp, { size: 16, style: { color: 'var(--q-text-tertiary)' } }) : React.createElement(ChevronDown, { size: 16, style: { color: 'var(--q-text-tertiary)' } })
    ]}),

    // Expanded content
    isExpanded && React.createElement('div', { style: { padding: '0 12px 12px 14px' }, children: [
      // Description — same style as skill/tool description
      agent.systemPrompt && (() => {
        const lines = agent.systemPrompt.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
        const desc = lines.slice(0, 3).join(' ').replace(/\*\*/g, '').trim();
        if (!desc) return null;
        return React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: desc });
      })(),
      // Files
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: ['File (', agent.files.length, ')'] }),
        MiniButton({ label: 'Add file', onClick: onAddFile }),
        agent.files.length > 0 && React.createElement(React.Fragment, { children: [
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: () => onRemoveAll('files'), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
        ]})
      ]}),
      agent.files.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'No files.' })
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }, children: agent.files.map(f =>
            React.createElement('div', { key: f, onClick: () => onOpenFile(f), style: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: '6px', border: 'none', backgroundColor: 'rgba(255, 255, 255, 0.04)', cursor: 'pointer' }, children: [
              React.createElement(FileText, { size: 14, style: { color: 'var(--q-tab-accent)' } }),
              React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: f }),
              React.createElement('button', { onClick: e => { e.stopPropagation(); onRemoveTag('file', f); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }, children: React.createElement(X, { size: 14, style: { color: 'var(--q-text-tertiary)' } }) })
            ]})
          )}
      ),

      // Skills
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: ['Skill (', agentSkills.length, ')'] }),
        MiniButton({ label: 'Add skill', onClick: onAddSkill }),
        agentSkills.length > 0 && React.createElement(React.Fragment, { children: [
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: () => onRemoveAll('skills'), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
        ]})
      ]}),
      agentSkills.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'No skill assigned.' })
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }, children: agentSkills.map(s =>
            TagChip({ key: s.name, icon: BookOpen, label: s.name, onRemove: () => onRemoveTag('skill', s.name) })
          )}),

      // MCP
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: ['MCP (', agentMcps.length, ')'] }),
        MiniButton({ label: 'Add MCP', onClick: onAddMcp }),
        agentMcps.length > 0 && React.createElement(React.Fragment, { children: [
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: () => onRemoveAll('mcp'), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
        ]})
      ]}),
      agentMcps.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'No MCP server assigned.' })
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }, children: agentMcps.map(s =>
            TagChip({ key: s.id, icon: Plug, label: s.name, onRemove: () => onRemoveTag('mcp', s.id) })
          )}),

      // Tools
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: ['Tool (', agentTools.length, ')'] }),
        MiniButton({ label: 'Add tool', onClick: onAddTool }),
        agentTools.length > 0 && React.createElement(React.Fragment, { children: [
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: () => onRemoveAll('tools'), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
        ]})
      ]}),
      agentTools.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'No tool assigned.' })
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }, children: agentTools.map(t =>
            TagChip({ key: t.name, icon: Wrench, label: t.name, onRemove: () => onRemoveTag('tool', t.name) })
          )}),

      // Delete agent
      agent.isDeletable && !hideDelete && React.createElement('div', { style: { marginTop: '12px' }, children:
        React.createElement('button', { onClick: onShowDelete, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '0', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: [React.createElement(Trash, { size: 16 }), ' Delete agent'] })
      })
    ]})
  ]});
}

function SkillRow({ icon, name, description, agentsUsing, badge, badgeColor, isExpanded, onToggle, onEdit, onDeleteSkill, onAddAgent, onRemoveAgent, onRemoveAllAgents }) {
  return React.createElement('div', { style: { marginBottom: '4px', backgroundColor: 'var(--q-bg-elevated)', border: 'none', borderRadius: '8px', overflow: 'hidden' }, children: [
    React.createElement('div', { onClick: onToggle, style: { padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '8px', transition: 'none' }, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(201, 112, 132, 0.03)'; }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }, children: [
      React.createElement(icon, { size: 16, style: { color: 'var(--q-tab-accent)', flexShrink: 0 } }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1 }, children: name }),
      badge && badgeColor && React.createElement(React.Fragment, { children: [
        React.createElement('span', { style: { padding: '2px 6px', borderRadius: 'var(--radius-sm)', backgroundColor: `color-mix(in srgb, ${badgeColor} 15%, transparent)`, color: badgeColor, fontSize: 'var(--fs-11)', fontFamily: 'var(--font-interface)' }, children: badge }),
        React.createElement('div', { style: { width: '8px', flexShrink: 0 } })
      ]}),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }, children: agentsUsing.length > 0 ? `${agentsUsing.length} ${agentsUsing.length > 1 ? 'agents' : 'agent'}` : 'None' }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      isExpanded ? React.createElement(ChevronUp, { size: 16, style: { color: 'var(--q-text-tertiary)' } }) : React.createElement(ChevronDown, { size: 16, style: { color: 'var(--q-text-tertiary)' } })
    ]}),
    isExpanded && React.createElement('div', { style: { padding: '0 12px 12px 14px' }, children: [
      description && React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5 }, children: description }),
      onEdit && React.createElement('div', { onClick: onEdit, style: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: '6px', border: 'none', backgroundColor: 'rgba(255, 255, 255, 0.04)', cursor: 'pointer', marginBottom: '8px' }, children: [
        React.createElement(FileText, { size: 14, style: { color: 'var(--q-tab-accent)' } }),
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'SKILL.md' })
      ]}),
      agentsUsing.length === 0
        ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [
            React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: [`No agent uses ${name}.`] }),
            MiniButton({ label: 'Add agent', onClick: onAddAgent })
          ]})
        : React.createElement(React.Fragment, { children: [
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
              React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: 'Used by:' }),
              MiniButton({ label: 'Add agent', onClick: onAddAgent }),
              React.createElement('span', { style: { flex: 1 } }),
              React.createElement('button', { onClick: onRemoveAllAgents, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
            ]}),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' }, children: agentsUsing.map(agentName =>
              React.createElement('div', { key: agentName, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: 'rgba(255, 255, 255, 0.04)' }, children: [
                React.createElement(Bot, { size: 16, style: { color: 'var(--q-accent-secondary)' } }),
                React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: agentName }),
                React.createElement('button', { onClick: () => onRemoveAgent(agentName), style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: React.createElement(X, { size: 16, style: { color: 'var(--q-text-tertiary)' } }) })
              ]})
            )})
          ]}),
      onDeleteSkill && React.createElement('div', { style: { marginTop: '12px' }, children:
        React.createElement('button', { onClick: onDeleteSkill, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '0', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: [React.createElement(Trash, { size: 16 }), ' Delete skill'] })
      })
    ]})
  ]});
}

export function FileEditor({ agentId, skillName, fileName, onClose }) {
  const { call } = useSidecarContext();
  const [content, setContent] = useState('Loading...');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    setContent('Loading...');
    setDirty(false);
    if (!call) return;
    (async () => {
      try {
        if (skillName) {
          const res = await call('readSkillFile', { name: skillName });
          setContent(res?.content || '');
        } else if (agentId) {
          const res = await call('readAgentFile', { id: agentId, filePath: fileName });
          setContent(res?.content || '');
        }
      } catch (e) {
        setContent(`Failed to load: ${e.message || e}`);
      }
    })();
  }, [agentId, skillName, fileName, call]);

  const handleSave = async () => {
    if (!call) return;
    setSaving(true);
    try {
      if (skillName) {
        await call('writeSkillFile', { name: skillName, content });
      } else if (agentId) {
        await call('writeAgentFile', { id: agentId, filePath: fileName, content });
      }
      setDirty(false);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) { console.error('Failed to save:', e); }
    setSaving(false);
  };

  // Auto-save: debounced 1s after last change
  const onContentChange = (val) => {
    setContent(val);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { handleSave(); saveTimer.current = null; }, 1000);
  };

  // Save on close if dirty
  const handleClose = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (dirty) handleSave();
    onClose();
  };

  return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: handleClose, children:
    React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '720px', height: '80vh', maxHeight: '600px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', overflow: 'hidden' }, onClick: e => e.stopPropagation(), children: [
      // Header
      React.createElement('div', { style: { padding: '10px 16px', backgroundColor: 'var(--q-bg-panel)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }, children: [
        React.createElement(FileText, { size: 16, style: { color: 'var(--q-tab-accent)', flexShrink: 0 } }),
        React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: skillName ? `${skillName}/SKILL.md` : `${agentId}/${fileName}` }),
        React.createElement('span', { style: { flex: 1 } }),
        dirty && React.createElement('span', { style: { color: 'var(--q-accent-warning)', fontSize: 'var(--fs-11)', fontFamily: 'var(--font-interface)', marginRight: '8px' }, children: 'Unsaved' }),
        dirty && React.createElement('span', { style: { color: 'var(--q-accent-warning)', fontSize: 'var(--fs-11)', fontFamily: 'var(--font-interface)', marginRight: '8px' }, children: 'Saving...' }),
        savedMsg && React.createElement('span', { style: { color: 'var(--q-accent-success)', fontSize: 'var(--fs-11)', fontFamily: 'var(--font-interface)', marginRight: '8px' }, children: savedMsg }),
        React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
        React.createElement('button', { onClick: handleClose, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }, children: React.createElement(X, { size: 18, style: { color: 'var(--q-text-secondary)' } }) })
      ]}),
      // Editor
      React.createElement('textarea', { value: content, onChange: e => onContentChange(e.target.value), style: { flex: 1, width: '100%', backgroundColor: 'var(--q-bg-code)', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'monospace', lineHeight: 1.6, padding: '16px', resize: 'none' } })
    ]})
  });
}

export function AddItemsModal({ title, items, initialSelected, onClose, onConfirm }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  // NASCONDI gli elementi già presenti (non mostrarli nella lista)
  const available = items.filter(item => !(initialSelected || []).includes(item.name));
  const filtered = available.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = (name) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: onClose, children:
    React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', maxWidth: '500px', maxHeight: '500px', width: '90%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)' }, onClick: e => e.stopPropagation(), children: [
      // Header
      React.createElement('div', { style: { padding: '16px', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center' }, children: [
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: title }),
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }, children: React.createElement(X, { size: 18, style: { color: 'var(--q-text-secondary)' } }) })
      ]}),
      // Search
      React.createElement('div', { style: { padding: '8px 16px' }, children:
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }, children: [
          React.createElement(Search, { size: 14, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }),
          React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
          React.createElement('input', { type: 'text', placeholder: 'Search...', value: search, onChange: e => setSearch(e.target.value), style: { flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' } })
        ]})
      }),
      // Items
      React.createElement('div', { style: { flex: 1, overflowY: 'auto' }, children:
        filtered.sort((a, b) => (selected.has(b.name) ? 1 : 0) - (selected.has(a.name) ? 1 : 0)).map(item => {
          const isSelected = selected.has(item.name);
          return React.createElement('div', { key: item.name, onClick: () => toggle(item.name), style: { padding: '4px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }, children: [
            React.createElement('div', { style: { flex: 1, minWidth: 0 }, children: [
              React.createElement('div', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: item.name }),
              item.description && React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: item.description })
            ]}),
            React.createElement('input', { type: 'checkbox', checked: isSelected, onChange: () => toggle(item.name), style: { accentColor: 'var(--q-tab-accent)', flexShrink: 0 } })
          ]});
        })
      }),
      // Footer
      React.createElement('div', { style: { padding: '8px 16px', display: 'flex', alignItems: 'center', }, children: [
        React.createElement('button', { className: 'q-press', onClick: () => setSelected(new Set(filtered.map(i => i.name))), disabled: filtered.length === 0, style: { background: 'none', border: 'none', cursor: filtered.length === 0 ? 'default' : 'pointer', color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }, children: 'Select all' }),
        React.createElement('button', { className: 'q-press', onClick: () => setSelected(new Set()), disabled: selected.size === 0, style: { background: 'none', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }, children: 'Deselect' }),
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', { onClick: onClose, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Cancel' }),
        React.createElement('div', { style: { width: '8px' } }),
        React.createElement('button', { onClick: () => onConfirm([...selected]), disabled: selected.size === 0, onMouseEnter: e => { if (selected.size > 0) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: selected.size === 0 ? 'default' : 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', opacity: selected.size === 0 ? 0.5 : 1 }, children: [`Add (`, selected.size, `)`] })
      ]})
    ]})
  });
}

function Modal({ onClose, title, children }) {
  return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: onClose, children:
    React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '420px', width: '90%' }, onClick: e => e.stopPropagation(), children: [
      React.createElement('div', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '16px' }, children: title }),
      children
    ]})
  });
}

function ConfirmButtons({ onCancel, onConfirm, confirmLabel, danger }) {
  return React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }, children: [
    React.createElement('button', { onClick: onCancel, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Cancel' }),
    React.createElement('div', { style: { width: '8px' } }),
    React.createElement('button', { onClick: onConfirm, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: confirmLabel })
  ]});
}

function IconButton({ icon, onClick, title }) {
  const [hover, setHover] = useState(false);
  return React.createElement('button', { onClick, title, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), style: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: hover ? 'var(--q-hover)' : 'transparent', color: hover ? 'var(--q-text)' : 'var(--q-text-secondary)', flexShrink: 0, padding: '0', transform: hover ? 'scale(1.02)' : 'scale(1)', transition: 'none' }, children: React.createElement(icon, { size: 20 }) });
}

// --- Form components ---

function NewAgentForm({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  return React.createElement(React.Fragment, { children: [
    React.createElement('input', { type: 'text', placeholder: 'Agent name...', autoFocus: true, value: name, onChange: e => setName(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }, onKeyDown: e => { if (e.key === 'Enter' && name.trim()) onCreate(name); } }),
    ConfirmButtons({ onCancel, onConfirm: () => onCreate(name), confirmLabel: 'Create' })
  ]});
}

function CreateSkillForm({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [content, setContent] = useState('');
  return React.createElement(React.Fragment, { children: [
    React.createElement('input', { type: 'text', placeholder: 'Skill name (e.g. code-review)', autoFocus: true, value: name, onChange: e => setName(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '8px' } }),
    React.createElement('input', { type: 'text', placeholder: 'Short description', value: desc, onChange: e => setDesc(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '8px' } }),
    React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '4px' }, children: 'SKILL.md content' }),
    React.createElement('textarea', { placeholder: 'Write skill instructions here...', value: content, onChange: e => setContent(e.target.value), style: { width: '100%', flex: 1, minHeight: '120px', maxHeight: '250px', backgroundColor: 'var(--q-bg-code)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'monospace', lineHeight: 1.5, padding: '8px 12px', outline: 'none', resize: 'none', marginBottom: '16px' } }),
    ConfirmButtons({ onCancel, onConfirm: () => onCreate(name, desc, content), confirmLabel: 'Create' })
  ]});
}

function InstallSkillForm({ onInstall, onCancel }) {
  const [pkg, setPkg] = useState('');
  return React.createElement(React.Fragment, { children: [
    React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'Install a skill from any source: GitHub repo (user/repo), direct URL to a .md file, or git URL. Will clone and copy SKILL.md.' }),
    React.createElement('input', { type: 'text', placeholder: 'user/repo, https://.../SKILL.md, or git URL', autoFocus: true, value: pkg, onChange: e => setPkg(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }, onKeyDown: e => { if (e.key === 'Enter' && pkg.trim()) onInstall(pkg); } }),
    ConfirmButtons({ onCancel, onConfirm: () => onInstall(pkg), confirmLabel: 'Install skill' })
  ]});
}

function NewFileForm({ onCreate, onCancel }) {
  const [fileName, setFileName] = useState('');
  return React.createElement(React.Fragment, { children: [
    React.createElement('input', { type: 'text', placeholder: 'File name (e.g. NOTES.md)', autoFocus: true, value: fileName, onChange: e => setFileName(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }, onKeyDown: e => { if (e.key === 'Enter' && fileName.trim()) onCreate(fileName); } }),
    ConfirmButtons({ onCancel, onConfirm: () => onCreate(fileName), confirmLabel: 'Create' })
  ]});
}
// ── McpRow: riga MCP nella sezione risorse (come SkillRow) ──
export function McpRow({ mcp, agentsUsing, isExpanded, onToggle, onAddAgent, onRemoveAgent, onRemoveAllAgents, onDeleteMcp }) {
  const subtitle = mcp.type === 'url' ? 'URL' : mcp.type === 'command' ? 'Command' : 'Package';
  return React.createElement('div', { style: { marginBottom: '4px', backgroundColor: 'var(--q-bg-elevated)', border: 'none', borderRadius: '8px', overflow: 'hidden' }, children: [
    React.createElement('div', { onClick: onToggle, style: { padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '8px', transition: 'none' }, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(201, 112, 132, 0.03)'; }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }, children: [
      React.createElement(Plug, { size: 16, style: { color: 'var(--q-tab-accent)', flexShrink: 0 } }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1 }, children: mcp.name }),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0 }, children: subtitle }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }, children: agentsUsing.length > 0 ? `${agentsUsing.length} ${agentsUsing.length > 1 ? 'agents' : 'agent'}` : 'None' }),
      React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
      isExpanded ? React.createElement(ChevronUp, { size: 16, style: { color: 'var(--q-text-tertiary)' } }) : React.createElement(ChevronDown, { size: 16, style: { color: 'var(--q-text-tertiary)' } })
    ]}),
    isExpanded && React.createElement('div', { style: { padding: '0 12px 12px 14px' }, children: [
      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5, wordBreak: 'break-word' }, children: mcp.description || (subtitle + ': ' + mcp.source) }),
      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5, wordBreak: 'break-all' }, children: [subtitle, ': ', mcp.source, mcp.args && mcp.args.length > 0 ? `  args: ${mcp.args.join(' ')}` : ''] }),
      React.createElement(React.Fragment, { children: [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }, children: [
          React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: 'Used by:' }),
          MiniButton({ label: 'Add agent', onClick: onAddAgent }),
          React.createElement('span', { style: { flex: 1 } }),
          agentsUsing.length > 0 && React.createElement('button', { onClick: onRemoveAllAgents, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Remove all' })
        ]}),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }, children: agentsUsing.map(a =>
          TagChip({ key: a, icon: Bot, label: a, onRemove: () => onRemoveAgent(a) })
        )})
      ]}),
      React.createElement('div', { style: { marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }, children: [
        React.createElement('button', { onClick: onDeleteMcp, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '0', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: [React.createElement(Trash, { size: 14 }), ' Uninstall'] })
      ]})
    ]})
  ]});
}

// ── McpInstallModal: installa / crea un MCP server (package o url) ──
export function McpInstallModal({ onClose, onInstalled }) {
  const { call } = useSidecarContext();
  const [type, setType] = useState('package');
  const [source, setSource] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const deriveName = (src) => {
    if (type === 'package') return (src.split('/').pop() || src).replace(/^server-/, '').replace(/^mcp-/, '');
    if (type === 'url') { try { const u = new URL(src.startsWith('http') ? src : 'http://' + src); return u.hostname.replace(/^www\./, ''); } catch { return src; } }
    if (type === 'command') return (src.trim().split(/\s+/)[0] || src).split('/').pop();
    return src;
  };
  const autoName = () => {
    const src = type === 'command' ? cmd : source;
    return src.trim() ? deriveName(src) : '';
  };
  const handleSource = (v) => setSource(v);
  const handleCmd = (v) => setCmd(v);
  const switchType = (t) => { setType(t); setSource(''); setCmd(''); setArgs(''); };

  const doInstall = async () => {
    if (type === 'command' && !cmd.trim()) { setMsg('Command is required.'); return; }
    if (type !== 'command' && !source.trim()) { setMsg('Source is required.'); return; }
    setBusy(true); setMsg(null);
    try {
      const finalName = autoName() || 'mcp-' + Date.now();
      const id = finalName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'mcp-' + Date.now();
      const params = { id, name: finalName };
      if (type === 'command') {
        params.type = 'command';
        params.command = cmd.trim();
        if (args) params.args = args.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
      } else {
        params.type = type;
        params.source = source.trim();
        if (type === 'package' && args) params.args = args.split(',').map(x => x.trim()).filter(Boolean);
      }
      const res = await call('addMcpServer', params);
      if (res?.ok === false) { setMsg('Install failed: ' + (res.error || 'unknown error')); setBusy(false); return; }
      const lst = await call('listMcpServers', {});
      if (onInstalled) onInstalled(lst?.servers || []);
      onClose();
    } catch (e) { setMsg('Error: ' + (e.message || e)); setBusy(false); }
  };

  return Modal({ onClose, title: 'Install MCP server', children: [
    msg && React.createElement('div', { style: { color: 'var(--q-accent-warning)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '12px' }, children: msg }),
    React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' }, children: [
      React.createElement('button', { onClick: () => switchType('package'), style: { flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (type === 'package' ? 'var(--q-tab-accent)' : 'var(--q-border)'), cursor: 'pointer', backgroundColor: type === 'package' ? 'var(--q-tab-accent)' : 'transparent', color: type === 'package' ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Package (npm)' }),
      React.createElement('button', { onClick: () => switchType('url'), style: { flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (type === 'url' ? 'var(--q-tab-accent)' : 'var(--q-border)'), cursor: 'pointer', backgroundColor: type === 'url' ? 'var(--q-tab-accent)' : 'transparent', color: type === 'url' ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'URL (remote)' }),
      React.createElement('button', { onClick: () => switchType('command'), style: { flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (type === 'command' ? 'var(--q-tab-accent)' : 'var(--q-border)'), cursor: 'pointer', backgroundColor: type === 'command' ? 'var(--q-tab-accent)' : 'transparent', color: type === 'command' ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Command' })
    ]}),
    type === 'command'
      ? React.createElement(FieldInput, { placeholder: 'Command (e.g. /usr/local/bin/mcp-server or bunx some-mcp-server)', value: cmd, onChange: handleCmd, mb: true })
      : React.createElement(FieldInput, { placeholder: type === 'url' ? 'https://example.com/mcp' : 'npm package (e.g. @modelcontextprotocol/server-filesystem)', value: source, onChange: handleSource, mb: true }),
    (type !== 'url') && React.createElement(React.Fragment, { children: [
      React.createElement(FieldTextarea, { placeholder: 'Args (optional)\nOne per line, or comma separated.\nExample for Filesystem:\n/Users/andrea/Documents\n/tmp', value: args, onChange: setArgs }),
      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginTop: '4px', marginBottom: '12px', lineHeight: 1.4 }, children: 'Args = extra parameters passed to the server when launched. E.g. for the Filesystem server these are the folders it can access.' })
    ]}),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '4px' }, children: [
      React.createElement('button', { onClick: onClose, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Cancel' }),
      React.createElement('button', { onClick: doInstall, disabled: busy, onMouseEnter: e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', opacity: busy ? 0.6 : 1 }, children: busy ? (type === 'package' ? 'Installing...' : 'Adding...') : 'Install' })
    ]})
  ]});
}

function FieldInput({ placeholder, value, onChange, mb }) {
  return React.createElement('input', { type: 'text', placeholder, value, onChange: e => onChange(e.target.value), style: { width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: mb ? '8px' : '0px' } });
}

function FieldTextarea({ placeholder, value, onChange }) {
  return React.createElement('textarea', { placeholder, value, rows: 4, onChange: e => onChange(e.target.value), style: { width: '100%', minHeight: '88px', maxHeight: '200px', resize: 'vertical', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-code)', padding: '8px 12px', outline: 'none', marginBottom: '8px', lineHeight: 1.5, boxSizing: 'border-box' } });
}
