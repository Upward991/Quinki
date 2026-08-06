import React, { useState, useEffect, useCallback } from 'react'
import { AgentRow } from '../agents/AgentRow'
import { AddItemsModal, FileEditor } from '../agents/AgentsPanel'
import { useSidecarContext } from '../shared/AppShell'
import type { Agent } from '../../types'

export function AgentConfigModal({ agentId, agents, onClose }: { agentId: string; agents: Agent[]; onClose: () => void }) {
  const { call } = useSidecarContext()
  const [agent, setAgent] = useState<Agent | null>(agents.find(a => a.id === agentId) || null)
  const [skills, setSkills] = useState<any[]>([])
  const [tools, setTools] = useState<any[]>([])
  const [renaming, setRenaming] = useState(false)
  const [deleteAgentName, setDeleteAgentName] = useState<string | null>(null)
  const [removeAllState, setRemoveAllState] = useState<any>(null)
  const [removeTagState, setRemoveTagState] = useState<any>(null)
  const [addItemsModal, setAddItemsModal] = useState<any>(null)
  const [fileEditor, setFileEditor] = useState<any>(null)
  const [addFileAgent, setAddFileAgent] = useState<string | null>(null)

  // Load skills + tools
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sr = await call('listSkills', {})
        if (!cancelled && sr?.skills) setSkills(sr.skills.map((s: any) => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })))
        const tr = await call('listTools', {})
        if (!cancelled && tr?.tools) setTools(tr.tools.map((t: any) => ({ name: t.name, description: t.description || '', readOnly: t.readOnly || false })))
      } catch (e) { console.error('AgentConfig load error:', e) }
    })()
    return () => { cancelled = true }
  }, [call])

  // Refresh agent from agents array
  useEffect(() => {
    const a = agents.find(a => a.id === agentId)
    if (a) setAgent(a)
  }, [agents, agentId])

  const doRenameAgent = useCallback(async (ag: Agent, newName: string) => {
    if (!call || !newName?.trim() || newName === ag.name) { setRenaming(false); return }
    try {
      await call('updateAgent', { id: ag.id, config: { name: newName.trim() } })
      setAgent(prev => prev ? { ...prev, name: newName.trim() } : prev)
    } catch (e) { console.error(e) }
    setRenaming(false)
  }, [call])

  const doAddSkillsToAgent = useCallback(async (id: string, skillNames: string[]) => {
    if (!call || !agent) return
    const existing = (agent.skills || []).map((s: any) => typeof s === 'string' ? s : s.name)
    const merged = [...new Set([...existing, ...skillNames])]
    try {
      await call('updateAgent', { id, config: { skills: merged } })
      setAgent(prev => prev ? { ...prev, skills: merged } : prev)
    } catch (e) { console.error(e) }
  }, [call, agent])

  const doAddToolsToAgent = useCallback(async (id: string, toolNames: string[]) => {
    if (!call || !agent) return
    const existing = (agent.tools || []).map((t: any) => typeof t === 'string' ? t : t.name)
    const merged = [...new Set([...existing, ...toolNames])]
    try {
      await call('updateAgent', { id, config: { tools: merged } })
      setAgent(prev => prev ? { ...prev, tools: merged } : prev)
    } catch (e) { console.error(e) }
  }, [call, agent])

  const doRemoveTag = useCallback(async (type: string, name: string) => {
    if (!call || !agent) return
    if (type === 'skill') {
      const remaining = (agent.skills || []).map((s: any) => typeof s === 'string' ? s : s.name).filter((n: string) => n !== name)
      try { await call('updateAgent', { id: agent.id, config: { skills: remaining } }); setAgent(prev => prev ? { ...prev, skills: remaining } : prev) } catch (e) { console.error(e) }
    } else if (type === 'tool') {
      const remaining = (agent.tools || []).map((t: any) => typeof t === 'string' ? t : t.name).filter((n: string) => n !== name)
      try { await call('updateAgent', { id: agent.id, config: { tools: remaining } }); setAgent(prev => prev ? { ...prev, tools: remaining } : prev) } catch (e) { console.error(e) }
    } else if (type === 'file') {
      try { await call('deleteAgentFile', { id: agent.id, fileName: name }); setAgent(prev => prev ? { ...prev, files: (prev.files || []).filter((f: string) => f !== name) } : prev) } catch (e) { console.error(e) }
    }
  }, [call, agent])

  const doRemoveAll = useCallback(async (type: string) => {
    if (!call || !agent) return
    if (type === 'skills') {
      try { await call('updateAgent', { id: agent.id, config: { skills: [] } }); setAgent(prev => prev ? { ...prev, skills: [] } : prev) } catch (e) { console.error(e) }
    } else if (type === 'tools') {
      try { await call('updateAgent', { id: agent.id, config: { tools: [] } }); setAgent(prev => prev ? { ...prev, tools: [] } : prev) } catch (e) { console.error(e) }
    } else if (type === 'files') {
      for (const f of (agent.files || [])) { try { await call('deleteAgentFile', { id: agent.id, fileName: f }) } catch {} }
      setAgent(prev => prev ? { ...prev, files: [] } : prev)
    }
  }, [call, agent])

  const doCreateFile = useCallback(async (agentName: string, fileName: string) => {
    if (!call) return
    const ag = agents.find(a => a.name === agentName)
    if (!ag) return
    try {
      await call('createAgentFile', { id: ag.id, fileName, content: '' })
      setAgent(prev => prev ? { ...prev, files: [...(prev.files || []), fileName] } : prev)
      setAddFileAgent(null)
      setFileEditor({ agentId: ag.id, fileName })
    } catch (e) { console.error(e) }
  }, [call, agents])

  const doDeleteAgent = useCallback(async (name: string) => {
    if (!call) return
    const ag = agents.find(a => a.name === name)
    if (!ag) return
    try { await call('deleteAgent', { id: ag.id }); onClose() } catch (e) { console.error(e) }
  }, [call, agents, onClose])

  if (!agent) return null

  return (
    <>
      {/* Modal overlay */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
        {/* Modal container */}
        <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{agent.name}</span>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', color: 'var(--q-text-secondary)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          {/* Body — AgentRow with isExpanded=true */}
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
              skills={skills}
              tools={tools}
              onShowDelete={() => setDeleteAgentName(agent.name)}
              onAddFile={() => setAddFileAgent(agent.name)}
              onAddSkill={() => setAddItemsModal({ title: `Add skill to ${agent.name}`, items: skills.map(s => ({ name: s.name, description: s.description })), initialSelected: (agent.skills||[]).map((s:any)=>s.name||s), onConfirm: (selected: string[]) => doAddSkillsToAgent(agent.id, selected) })}
              onAddTool={() => setAddItemsModal({ title: `Add tool to ${agent.name}`, items: tools.map(t => ({ name: t.name, description: t.description })), initialSelected: (agent.tools||[]).map((t:any)=>t.name||t), onConfirm: (selected: string[]) => doAddToolsToAgent(agent.id, selected) })}
              onOpenFile={(fileName: string) => setFileEditor({ agentId: agent.id, fileName })}
              onRemoveTag={(type: string, name: string) => setRemoveTagState({ type, name, agent: agent.name })}
              onRemoveAll={(type: string) => setRemoveAllState({ type, agentName: agent.name })}
            />
          </div>
        </div>
      </div>

      {/* Sub-modals — same as AgentsPanel */}
      {deleteAgentName && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDeleteAgentName(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Delete "{deleteAgentName}"?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setDeleteAgentName(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
              <button onClick={() => doDeleteAgent(deleteAgentName)} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

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
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAddFileAgent(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '12px' }}>New file</div>
            <input type="text" placeholder="file.txt" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) doCreateFile(addFileAgent, v) } }} style={{ width: '100%', padding: '8px 12px', backgroundColor: 'var(--q-bg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', outline: 'none', marginBottom: '16px' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setAddFileAgent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
              <button onClick={(e) => { const input = (e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement); if (input?.value?.trim()) doCreateFile(addFileAgent, input.value.trim()) }} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-tab-accent)', color: 'var(--q-bg)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}