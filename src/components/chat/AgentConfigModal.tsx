import React, { useState, useEffect, useCallback, useRef } from 'react'
import { AgentRow } from '../agents/AgentRow'
import { AddItemsModal, FileEditor } from '../agents/AgentsPanel'
import { useSidecarContext } from '../shared/AppShell'

export function AgentConfigModal({ agentId, agents, onClose }: { agentId: string; agents: any[]; onClose: () => void }) {
  const { call } = useSidecarContext()
  // Raw agent config from sidecar (skills/tools as strings)
  const [agentCfg, setAgentCfg] = useState<any>(null)
  const [allSkills, setAllSkills] = useState<any[]>([])
  const [allTools, setAllTools] = useState<any[]>([])
  const [agentFiles, setAgentFiles] = useState<string[]>([])
  const [removeAllState, setRemoveAllState] = useState<any>(null)
  const [removeTagState, setRemoveTagState] = useState<any>(null)
  const [addItemsModal, setAddItemsModal] = useState<any>(null)
  const [fileEditor, setFileEditor] = useState<any>(null)
  const [addFileAgent, setAddFileAgent] = useState(false)

  // Load agent config from sidecar (strings, not objects)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Get full agent config
        const res = await call('listAgents', {})
        if (cancelled || !res?.agents) return
        const found = res.agents.find((a: any) => a.id === agentId)
        if (found) {
          // Normalize: skills/tools as string arrays
          const skills = (found.skills || []).map((s: any) => typeof s === 'string' ? s : s.name)
          const tools = (found.tools || []).map((t: any) => typeof t === 'string' ? t : t.name)
          setAgentCfg({ ...found, skills, tools })
        }

        // Load all skills
        const sr = await call('listSkills', {})
        if (!cancelled && sr?.skills) setAllSkills(sr.skills.map((s: any) => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })))

        // Load all tools
        const tr = await call('listTools', {})
        if (!cancelled && tr?.tools) setAllTools(tr.tools.map((t: any) => ({ name: t.name, description: t.description || '', readOnly: t.readOnly || false })))

        // Load agent files
        const fr = await call('listAgentFiles', { id: agentId })
        if (!cancelled && fr?.files) setAgentFiles(fr.files.map((f: any) => typeof f === 'string' ? f : f.name))
      } catch (e) { console.error('AgentConfig load error:', e) }
    })()
    return () => { cancelled = true }
  }, [agentId, call])

  // Build agent object for AgentRow (with object skills/tools like mapAgent)
  const agent = agentCfg ? {
    id: agentCfg.id,
    name: agentCfg.name || agentCfg.id,
    skills: (agentCfg.skills || []).map((s: string) => ({ name: s, source: 'local', installed: true })),
    tools: (agentCfg.tools || []).map((t: string) => ({ name: t, enabled: true })),
    files: agentFiles,
    isDeletable: agentCfg.id !== 'orchestrator' && agentCfg.id !== 'quinki-expert'
  } : null

  const doAddSkills = useCallback(async (skillNames: string[]) => {
    if (!call || !agentCfg) return
    const existing = agentCfg.skills || []
    const merged = [...new Set([...existing, ...skillNames])]
    try {
      await call('updateAgent', { id: agentId, config: { skills: merged } })
      setAgentCfg(prev => prev ? { ...prev, skills: merged } : prev)
    } catch (e) { console.error(e) }
  }, [call, agentCfg, agentId])

  const doAddTools = useCallback(async (toolNames: string[]) => {
    if (!call || !agentCfg) return
    const existing = agentCfg.tools || []
    const merged = [...new Set([...existing, ...toolNames])]
    try {
      await call('updateAgent', { id: agentId, config: { tools: merged } })
      setAgentCfg(prev => prev ? { ...prev, tools: merged } : prev)
    } catch (e) { console.error(e) }
  }, [call, agentCfg, agentId])

  const doRemoveTag = useCallback(async (type: string, name: string) => {
    if (!call || !agentCfg) return
    if (type === 'skill') {
      const remaining = (agentCfg.skills || []).filter((n: string) => n !== name)
      try { await call('updateAgent', { id: agentId, config: { skills: remaining } }); setAgentCfg(prev => prev ? { ...prev, skills: remaining } : prev) } catch (e) { console.error(e) }
    } else if (type === 'tool') {
      const remaining = (agentCfg.tools || []).filter((n: string) => n !== name)
      try { await call('updateAgent', { id: agentId, config: { tools: remaining } }); setAgentCfg(prev => prev ? { ...prev, tools: remaining } : prev) } catch (e) { console.error(e) }
    } else if (type === 'file') {
      try { await call('deleteAgentFile', { id: agentId, fileName: name }); setAgentFiles(prev => prev.filter(f => f !== name)) } catch (e) { console.error(e) }
    }
  }, [call, agentCfg, agentId])

  const doRemoveAll = useCallback(async (type: string) => {
    if (!call || !agentCfg) return
    if (type === 'skills') {
      try { await call('updateAgent', { id: agentId, config: { skills: [] } }); setAgentCfg(prev => prev ? { ...prev, skills: [] } : prev) } catch (e) { console.error(e) }
    } else if (type === 'tools') {
      try { await call('updateAgent', { id: agentId, config: { tools: [] } }); setAgentCfg(prev => prev ? { ...prev, tools: [] } : prev) } catch (e) { console.error(e) }
    } else if (type === 'files') {
      for (const f of agentFiles) { try { await call('deleteAgentFile', { id: agentId, fileName: f }) } catch {} }
      setAgentFiles([])
    }
  }, [call, agentCfg, agentId, agentFiles])

  const doCreateFile = useCallback(async (fileName: string) => {
    if (!call) return
    try {
      await call('createAgentFile', { id: agentId, fileName, content: '' })
      setAgentFiles(prev => [...prev, fileName])
      setAddFileAgent(false)
      setFileEditor({ agentId, fileName })
    } catch (e) { console.error(e) }
  }, [call, agentId])

  if (!agent) return null

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
        <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{agent.name}</span>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', color: 'var(--q-text-secondary)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            <AgentRow
              agent={agent}
              isExpanded={true}
              isRenaming={false}
              hideHeader={true}
              hideDelete={true}
              onToggle={() => {}}
              onStartRename={() => {}}
              onCommitRename={() => {}}
              skills={allSkills}
              tools={allTools}
              onShowDelete={() => {}}
              onAddFile={() => setAddFileAgent(true)}
              onAddSkill={() => setAddItemsModal({ title: `Add skill to ${agent.name}`, items: allSkills.map(s => ({ name: s.name, description: s.description })), initialSelected: agentCfg?.skills || [], onConfirm: doAddSkills })}
              onAddTool={() => setAddItemsModal({ title: `Add tool to ${agent.name}`, items: allTools.map(t => ({ name: t.name, description: t.description })), initialSelected: agentCfg?.tools || [], onConfirm: doAddTools })}
              onOpenFile={(fileName: string) => setFileEditor({ agentId, fileName })}
              onRemoveTag={(type: string, name: string) => setRemoveTagState({ type, name, agent: agent.name })}
              onRemoveAll={(type: string) => setRemoveAllState({ type, agentName: agent.name })}
            />
          </div>
        </div>
      </div>

      {removeAllState && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRemoveAllState(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Remove all {removeAllState.type} from agent "{removeAllState.agentName}"?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRemoveAllState(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
              <button onClick={() => { doRemoveAll(removeAllState.type); setRemoveAllState(null) }} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {removeTagState && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRemoveTagState(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Remove {removeTagState.type} "{removeTagState.name}" from agent "{removeTagState.agent}"?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRemoveTagState(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
              <button onClick={() => { doRemoveTag(removeTagState.type, removeTagState.name); setRemoveTagState(null) }} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {addItemsModal && (
        <AddItemsModal title={addItemsModal.title} items={addItemsModal.items} initialSelected={addItemsModal.initialSelected || []} onClose={() => setAddItemsModal(null)} onConfirm={(selected: string[]) => { addItemsModal.onConfirm(selected); setAddItemsModal(null) }} />
      )}

      {fileEditor && (
        <FileEditor agentId={fileEditor.agentId} skillName={fileEditor.skillName} fileName={fileEditor.fileName} onClose={() => setFileEditor(null)} />
      )}

      {addFileAgent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAddFileAgent(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '12px' }}>New file</div>
            <input type="text" placeholder="file.txt" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) doCreateFile(v) } }} style={{ width: '100%', padding: '8px 12px', backgroundColor: 'var(--q-bg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', outline: 'none', marginBottom: '16px' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setAddFileAgent(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
              <button onClick={(e) => { const input = (e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement); if (input?.value?.trim()) doCreateFile(input.value.trim()) }} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-tab-accent)', color: 'var(--q-bg)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}