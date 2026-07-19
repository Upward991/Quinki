// ============================================================
// AgentsPanel — exact Flutter copy
// Header: Home + DoubleBot + "Agents" + Save/Save&Restart (red)
// Body: 3 sections — Your agents, Installed resources, Plan mode
// All text in English
// ============================================================

import { useState, useRef, useEffect } from 'react'
import type { Agent } from '../../types'
import { Home, Bot, Package, Shield, Plus, ChevronDown, ChevronUp, Search, Save, Power, Pencil, X, BookOpen, Wrench, Trash, FileText } from '../icons'

interface AgentsPanelProps {
  activePanel: string
  onSelectPanel: (panel: string) => void
  agents: Agent[]
}

// Mock skills and tools
const mockSkills = [
  { name: 'quinki-expert', description: 'Quinki Expert core skill for managing and monitoring dashboards', source: 'local' },
  { name: 'find-skills', description: 'Search and discover skills from pi.dev registry', source: 'pi.dev' },
  { name: 'ddg-search', description: 'DuckDuckGo web search skill', source: 'pi.dev' },
  { name: 'ponytail', description: 'Ponytail CSS framework skill', source: 'pi.dev' },
  { name: 'notion-api', description: 'Notion API integration skill', source: 'pi.dev' },
]

const mockTools = [
  { name: 'read', description: 'Read file contents', readOnly: true },
  { name: 'write', description: 'Write file contents', readOnly: false },
  { name: 'edit', description: 'Edit file with find/replace', readOnly: false },
  { name: 'bash', description: 'Execute bash commands', readOnly: false },
  { name: 'grep', description: 'Search file contents with regex', readOnly: true },
  { name: 'find', description: 'Find files by name or pattern', readOnly: true },
  { name: 'ls', description: 'List directory contents', readOnly: true },
  { name: 'skill', description: 'Execute a skill', readOnly: false },
  { name: 'delegate_to_agent', description: 'Delegate task to another agent', readOnly: false },
]

const planModeTools = ['read', 'grep', 'find', 'ls']

export function AgentsPanel(props: AgentsPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const [agentSearch, setAgentSearch] = useState('')
  const [skillSearch, setSkillSearch] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [expandedResource, setExpandedResource] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [renamingAgent, setRenamingAgent] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showCreateSkill, setShowCreateSkill] = useState(false)
  const [showInstallSkill, setShowInstallSkill] = useState(false)
  const [showDeleteAgent, setShowDeleteAgent] = useState<string | null>(null)
  const [showRemoveAll, setShowRemoveAll] = useState<{ type: string; agentName: string } | null>(null)
  const [showPicker, setShowPicker] = useState<{ title: string; items: { name: string; description: string }[] } | null>(null)
  const [showFileEditor, setShowFileEditor] = useState<string | null>(null)
  const [showCreateFile, setShowCreateFile] = useState<string | null>(null)
  const [showRemoveOne, setShowRemoveOne] = useState<{ type: string; name: string; agent: string } | null>(null)
  const [showError, setShowError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [showSuccess, setShowSuccess] = useState<string | null>(null)

  useEffect(() => {
    setShowError('Failed to load agents.\n\nError: ECONNREFUSED 127.0.0.1:0\n    at Object.call (sidecar_service.dart:142)\n    at AgentsPanel.load (agents_panel.dart:55)\n\nVerify that the sidecar is active and that the Pi Agent SDK is installed.')
  }, [])

  const filteredAgents = props.agents.filter(a => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
  const filteredSkills = mockSkills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase()))
  const filteredTools = mockTools.filter(t => t.name.toLowerCase().includes(toolSearch.toLowerCase()))

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', flex: 1, minHeight: 0 }}>
        {/* Header */}
        <div style={{ marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <div style={panelStyle}>
            <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
          </div>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <div style={{ ...panelStyle, flex: 1 }}>
            <div style={{ width: '8px', flexShrink: 0 }} />
            <Bot size={18} style={{ color: 'var(--q-accent-secondary)', flexShrink: 0 }} />
            <div style={{ width: '16px', flexShrink: 0 }} />
            <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Agents</span>
            <span style={{ flex: 1 }} />
            {saveMessage && (<><span style={{ color: 'var(--q-accent-success)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{saveMessage}</span><div style={{ width: '16px', flexShrink: 0 }} /></>)}
            {dirty && (<><span style={{ color: 'var(--q-accent-warning)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>Unsaved</span><div style={{ width: '8px', flexShrink: 0 }} /></>)}
            <button onClick={() => { setDirty(false); setSaveMessage('Settings saved.'); setTimeout(() => setSaveMessage(null), 5000) }} style={{ height: '32px', padding: '0 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', flexShrink: 0 }}>
              <Save size={16} /> Save
            </button>
            <div style={{ width: '8px', flexShrink: 0 }} />
            <button onClick={() => { setDirty(false); setSaveMessage('Saved. Restarting...'); setTimeout(() => setSaveMessage(null), 5000) }} style={{ height: '32px', padding: '0 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--q-bg)', fontSize: '14px', fontWeight: 500, fontFamily: 'var(--font-interface)', flexShrink: 0 }}>
              <Power size={16} /> Save and restart
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 16px 0 16px', overscrollBehavior: 'contain' } as React.CSSProperties}>
          {/* Section: Your agents */}
          <Section icon={Bot} title="Your agents">
            <AddButton label="New agent" onClick={() => setShowCreateAgent(true)} />
            <div style={{ height: '8px' }} />
            <SearchField placeholder="Search agents..." value={agentSearch} onChange={setAgentSearch} />
            <div style={{ height: '8px' }} />
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {filteredAgents.map(agent => (
                <AgentToggle
                  key={agent.id}
                  agent={agent}
                  isExpanded={expandedAgentId === agent.id}
                  isRenaming={renamingAgent === agent.id}
                  onToggle={() => setExpandedAgentId(expandedAgentId === agent.id ? null : agent.id)}
                  onStartRename={() => setRenamingAgent(agent.id)}
                  onCommitRename={() => setRenamingAgent(null)}
                  skills={mockSkills}
                  tools={mockTools}
                  onShowDelete={() => setShowDeleteAgent(agent.name)}
                  onAddFile={() => setShowCreateFile(agent.name)}
                  onAddSkill={() => setShowPicker({ title: 'Add skill', items: mockSkills.map(s => ({ name: s.name, description: s.description })) })}
                  onAddTool={() => setShowPicker({ title: 'Add tool', items: mockTools.map(t => ({ name: t.name, description: t.description })) })}
                  onOpenFile={(name) => setShowFileEditor(name)}
                  onRemoveTag={(type, name) => setShowRemoveOne({ type, name, agent: agent.name })}
                  onRemoveAll={(type) => setShowRemoveAll({ type, agentName: agent.name })}
                />
              ))}
            </div>
          </Section>

          {/* Section: Installed resources */}
          <Section icon={Package} title="Installed resources">
            {/* Skills container */}
            <ResourceContainer title={`Skill (${mockSkills.length})`} action={<><AddBtn label="Create skill" onClick={() => setShowCreateSkill(true)} /><AddBtn label="Install skill" onClick={() => setShowInstallSkill(true)} /></>}>
              <SearchField placeholder="Search skill..." value={skillSearch} onChange={setSkillSearch} />
              <div style={{ height: '8px' }} />
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {filteredSkills.length === 0 ? (
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No skill found.</span>
                ) : filteredSkills.map(s => {
                  const agentsUsing = props.agents.filter(a => a.skills.some(sk => sk.name === s.name))
                  return (
                    <ResourceRow
                      key={s.name} icon={BookOpen} name={s.name} description={s.description}
                      agentsUsing={agentsUsing.map(a => a.name)}
                      isExpanded={expandedResource === s.name}
                      onToggle={() => setExpandedResource(expandedResource === s.name ? null : s.name)}
                      onEdit={() => setShowFileEditor('SKILL.md')}
                      onDeleteSkill={() => setShowRemoveOne({ type: 'skill', name: s.name, agent: '' })}
                      onAddAgent={() => setShowPicker({ title: 'Add agent to ' + s.name, items: props.agents.map(a => ({ name: a.name, description: a.id })) })}
                      onRemoveAgent={(agent) => setShowRemoveOne({ type: 'agent', name: agent, agent: s.name })}
                      onRemoveAllAgents={() => setShowRemoveAll({ type: 'agents', agentName: s.name })}
                    />
                  )
                })}
              </div>
            </ResourceContainer>

            <div style={{ height: '8px' }} />

            {/* Tools container */}
            <ResourceContainer title={`Tool (${mockTools.length})`} action={<AddBtn label="Add tool" onClick={() => setShowPicker({ title: 'Add tool', items: mockTools.map(t => ({ name: t.name, description: t.description })) })} />}>
              <SearchField placeholder="Search tool..." value={toolSearch} onChange={setToolSearch} />
              <div style={{ height: '8px' }} />
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {filteredTools.map(t => {
                  const agentsUsing = props.agents.filter(a => a.tools.some(to => to.name === t.name))
                  return (
                    <ResourceRow
                      key={t.name} icon={Wrench} name={t.name} description={t.description}
                      agentsUsing={agentsUsing.map(a => a.name)}
                      badge={t.readOnly ? 'read' : 'write'}
                      badgeColor={t.readOnly ? 'var(--q-accent-success)' : 'var(--q-accent-danger)'}
                      isExpanded={expandedResource === t.name}
                      onToggle={() => setExpandedResource(expandedResource === t.name ? null : t.name)}
                      onAddAgent={() => setShowPicker({ title: 'Add agent to ' + t.name, items: props.agents.map(a => ({ name: a.name, description: a.id })) })}
                      onRemoveAgent={(agent) => setShowRemoveOne({ type: 'agent', name: agent, agent: t.name })}
                      onRemoveAllAgents={() => setShowRemoveAll({ type: 'agents', agentName: t.name })}
                    />
                  )
                })}
              </div>
            </ResourceContainer>
          </Section>

          {/* Section: Plan mode */}
          <Section icon={Shield} title="Plan mode">
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>Tools enabled in Plan mode. Applies to all agents.</span>
            <div style={{ height: '8px' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {planModeTools.map(name => (
                <Tag key={name} icon={Wrench} label={name} onRemove={() => setShowRemoveOne({ type: 'plan mode tool', name, agent: 'Plan mode' })} />
              ))}
              <AddBtn label="Add tool" onClick={() => setShowPicker({ title: 'Enable tool in Plan mode', items: mockTools.filter(t => !planModeTools.includes(t.name)).map(t => ({ name: t.name, description: t.description })) })} />
            </div>
          </Section>

          <div style={{ height: '32px' }} />
        </div>
      </div>

      {/* Create agent modal */}
      {showCreateAgent && (
        <Modal onClose={() => setShowCreateAgent(false)} title="New agent">
          <input type="text" placeholder="Agent name..." autoFocus style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }} onKeyDown={e => { if (e.key === 'Enter') setShowCreateAgent(false) }} />
          <ModalActions onCancel={() => setShowCreateAgent(false)} onConfirm={() => setShowCreateAgent(false)} confirmLabel="Create" />
        </Modal>
      )}

      {/* Create skill modal — name + description + SKILL.md content */}
      {showCreateSkill && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCreateSkill(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '520px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>Create new skill</div>
            <input type="text" placeholder="Skill name (e.g. code-review)" autoFocus style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '8px' }} />
            <input type="text" placeholder="Short description" style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '8px' }} />
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '4px' }}>SKILL.md content</div>
            <textarea placeholder="Write skill instructions here..." style={{ width: '100%', flex: 1, minHeight: '120px', maxHeight: '250px', backgroundColor: 'var(--q-bg-code)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5', padding: '8px 12px', outline: 'none', resize: 'none', marginBottom: '16px' }} />
            <ModalActions onCancel={() => setShowCreateSkill(false)} onConfirm={() => setShowCreateSkill(false)} confirmLabel="Create" />
          </div>
        </div>
      )}

      {/* Install skill modal */}
      {showInstallSkill && (
        <Modal onClose={() => setShowInstallSkill(false)} title="Install skill from internet">
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>GitHub repo (e.g. openai/skills). Will clone and copy SKILL.md</div>
          <input type="text" placeholder="user/repo (e.g. openai/skills)" autoFocus style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }} />
          <ModalActions onCancel={() => setShowInstallSkill(false)} onConfirm={() => { setShowInstallSkill(false); setInstalling(true); setTimeout(() => { setInstalling(false); setShowSuccess('Skill installed successfully: user/repo'); }, 2000) }} confirmLabel="Install skill" />
        </Modal>
      )}

      {/* Delete agent modal */}
      {showDeleteAgent && (
        <Modal onClose={() => setShowDeleteAgent(null)} title="Delete agent">
          <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Delete "{showDeleteAgent}"?</div>
          <ModalActions onCancel={() => setShowDeleteAgent(null)} onConfirm={() => setShowDeleteAgent(null)} confirmLabel="Delete" />
        </Modal>
      )}

      {/* Remove all confirmation */}
      {/* Remove all confirmation */}
      {showRemoveAll && (
        <Modal onClose={() => setShowRemoveAll(null)} title={`Remove all ${showRemoveAll.type}`}>
          <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Remove all {showRemoveAll.type} from agent "{showRemoveAll.agentName}"?</div>
          <ModalActions onCancel={() => setShowRemoveAll(null)} onConfirm={() => setShowRemoveAll(null)} confirmLabel="Remove all" />
        </Modal>
      )}

      {/* Remove single item confirmation */}
      {showRemoveOne && (
        <Modal onClose={() => setShowRemoveOne(null)} title={`Remove ${showRemoveOne.type}`}>
          <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Remove {showRemoveOne.type} "{showRemoveOne.name}" from agent "{showRemoveOne.agent}"?</div>
          <ModalActions onCancel={() => setShowRemoveOne(null)} onConfirm={() => setShowRemoveOne(null)} confirmLabel="Remove" />
        </Modal>
      )}

      {/* Error modal — with Copy button */}
      {showError && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowError(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '500px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--q-accent-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span style={{ color: 'var(--q-accent-danger)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Error</span>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' }}>
              <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{showError}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => { navigator.clipboard.writeText(showError); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                Copy
              </button>
              <button onClick={() => setShowError(null)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Loading modal — installing skill */}
      {installing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '20px', height: '20px', border: '2px solid var(--q-text-tertiary)', borderTopColor: 'var(--q-accent-danger)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Installing skill...</span>
          </div>
        </div>
      )}

      {/* Success modal */}
      {showSuccess && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowSuccess(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '500px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--q-accent-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
              <span style={{ color: 'var(--q-accent-success)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Done</span>
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>{showSuccess}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSuccess(null)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Picker modal (Add tool/skill/agent) */}
      {showPicker && (
        <PickerModal title={showPicker.title} items={showPicker.items} onClose={() => setShowPicker(null)} />
      )}

      {/* File editor modal — exact Flutter _FileEditorDialog copy */}
      {showFileEditor && <FileEditorModal fileName={showFileEditor} onClose={() => setShowFileEditor(null)} />}

      {/* Create file modal */}
      {showCreateFile && (
        <Modal onClose={() => setShowCreateFile(null)} title="New file">
          <input type="text" placeholder="File name (e.g. NOTES.md)" autoFocus style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none', marginBottom: '16px' }} onKeyDown={e => { if (e.key === 'Enter') setShowCreateFile(null) }} />
          <ModalActions onCancel={() => setShowCreateFile(null)} onConfirm={() => setShowCreateFile(null)} confirmLabel="Create" />
        </Modal>
      )}

    </div>
  )
}

// ── Section panel ──
function Section({ icon: Icon, title, children }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', marginBottom: '8px', padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Icon size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

// ── Search field ──
function SearchField({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
      <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
      <input type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} />
      {value && <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '14px' }}>✕</button>}
    </div>
  )
}

// ── Add button (large) ──
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent' }}>
      <Plus size={16} style={{ color: 'var(--q-text-secondary)' }} />
      <span style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{label}</span>
    </button>
  )
}

// ── Add button (small) ──
function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent' }}>
      <Plus size={14} style={{ color: 'var(--q-text-tertiary)' }} />
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{label}</span>
    </button>
  )
}

// ── Tag (plan mode chips, agent tags) ──
function Tag({ icon: Icon, label, onRemove }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; label: string; onRemove?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)' }}>
      <Icon size={14} style={{ color: 'var(--q-text-secondary)' }} />
      <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{label}</span>
      {onRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}>
          <X size={14} style={{ color: 'var(--q-text-tertiary)' }} />
        </button>
      )}
    </div>
  )
}

// ── Agent toggle ──
function AgentToggle({ agent, isExpanded, isRenaming, onToggle, onStartRename, onCommitRename, skills, tools, onShowDelete, onAddFile, onAddSkill, onAddTool, onOpenFile, onRemoveTag, onRemoveAll }: {
  agent: Agent; isExpanded: boolean; isRenaming: boolean; onToggle: () => void; onStartRename: () => void; onCommitRename: () => void
  skills: typeof mockSkills; tools: typeof mockTools; onShowDelete: () => void
  onAddFile: () => void; onAddSkill: () => void; onAddTool: () => void; onOpenFile: (name: string) => void; onRemoveTag: (type: string, name: string) => void; onRemoveAll: (type: string) => void
}) {
  const agentSkills = skills.filter(s => agent.skills.some(sk => sk.name === s.name))
  const agentTools = tools.filter(t => agent.tools.some(to => to.name === t.name))
  const canRename = agent.id !== 'quinki-expert' && agent.id !== 'orchestrator'

  return (
    <div style={{ marginBottom: '4px', backgroundColor: 'var(--q-bg-elevated)', border: `1px solid ${isExpanded ? 'rgba(217, 107, 107, 0.3)' : 'var(--q-border)'}`, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Header */}
      <div onClick={onToggle} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <Bot size={16} style={{ color: 'var(--q-accent-danger)', flexShrink: 0 }} />
        <div style={{ width: '8px', flexShrink: 0 }} />
        {isRenaming ? (
          <input type="text" defaultValue={agent.name} autoFocus onBlur={onCommitRename} onKeyDown={e => { if (e.key === 'Enter') onCommitRename() }} onClick={e => e.stopPropagation()} style={{ flex: 1, color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)', backgroundColor: 'transparent', border: 'none', outline: 'none', padding: '0' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
            {canRename && (
              <button onClick={(e) => { e.stopPropagation(); onStartRename() }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', flexShrink: 0 }}>
                <Pencil size={13} style={{ color: 'var(--q-text-tertiary)' }} />
              </button>
            )}
          </div>
        )}
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 }}>{agentSkills.length} skill · {agentTools.length} tool</span>
        <div style={{ width: '8px', flexShrink: 0 }} />
        {isExpanded ? <ChevronUp size={16} style={{ color: 'var(--q-text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--q-text-tertiary)' }} />}
      </div>
      {/* Expanded body — File, Skill, Tool, Delete (no model/thinking/system prompt) */}
      {isExpanded && (
        <div style={{ padding: '0 12px 12px 12px' }}>
          {/* File */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>File ({agent.files.length})</span>
            <AddBtn label="Add file" onClick={onAddFile} />
            {agent.files.length > 0 && (
              <>
                <span style={{ flex: 1 }} />
                <button onClick={() => onRemoveAll('files')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Remove all</button>
              </>
            )}
          </div>
          {agent.files.length === 0 ? (
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No files.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
              {agent.files.map(f => (
                <div key={f} onClick={() => onOpenFile(f)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)', cursor: 'pointer' }}>
                  <FileText size={14} style={{ color: 'var(--q-text-secondary)' }} />
                  <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{f}</span>
                  <button onClick={(e) => { e.stopPropagation(); onRemoveTag('file', f) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}>
                    <X size={14} style={{ color: 'var(--q-text-tertiary)' }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Skill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Skill ({agentSkills.length})</span>
            <AddBtn label="Add skill" onClick={onAddSkill} />
            {agentSkills.length > 0 && (
              <>
                <span style={{ flex: 1 }} />
                <button onClick={() => onRemoveAll('skills')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Remove all</button>
              </>
            )}
          </div>
          {agentSkills.length === 0 ? (
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No skill assigned.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
              {agentSkills.map(s => <Tag key={s.name} icon={BookOpen} label={s.name} onRemove={() => onRemoveTag('skill', s.name)} />)}
            </div>
          )}
          {/* Tool */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Tool ({agentTools.length})</span>
            <AddBtn label="Add tool" onClick={onAddTool} />
            {agentTools.length > 0 && (
              <>
                <span style={{ flex: 1 }} />
                <button onClick={() => onRemoveAll('tools')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Remove all</button>
              </>
            )}
          </div>
          {agentTools.length === 0 ? (
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No tool assigned.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {agentTools.map(t => <Tag key={t.name} icon={Wrench} label={t.name} onRemove={() => onRemoveTag('tool', t.name)} />)}
            </div>
          )}
          {/* Delete agent (only for deletable, not expert/orchestrator, and if more than 1 agent) */}
          {agent.isDeletable && (
            <div style={{ marginTop: '16px' }}>
              <button onClick={onShowDelete} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
                <Trash size={16} /> Delete agent
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Resource container ──
function ResourceContainer({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── Resource row (skill/tool expandable) ──
function ResourceRow({ icon: Icon, name, description, agentsUsing, badge, badgeColor, isExpanded, onToggle, onEdit, onDelete, onAddAgent, onRemoveAgent, onRemoveAllAgents, onDeleteSkill }: {
  icon: React.FC<{ size?: number; style?: React.CSSProperties }>; name: string; description: string; agentsUsing: string[]
  badge?: string; badgeColor?: string; isExpanded: boolean; onToggle: () => void; onEdit?: () => void; onDelete?: () => void
  onAddAgent: () => void; onRemoveAgent: (agent: string) => void; onRemoveAllAgents: () => void; onDeleteSkill?: () => void
}) {
  return (
    <div style={{ marginBottom: '4px', backgroundColor: 'var(--q-bg-elevated)', border: `1px solid ${isExpanded ? 'rgba(217, 107, 107, 0.3)' : 'var(--q-border)'}`, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <Icon size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <div style={{ width: '8px', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1 }}>{name}</span>
        {badge && badgeColor && (
          <>
            <span style={{ padding: '2px 6px', borderRadius: '3px', backgroundColor: `${badgeColor}26`, color: badgeColor, fontSize: '11px', fontFamily: 'var(--font-interface)' }}>{badge}</span>
            <div style={{ width: '8px', flexShrink: 0 }} />
          </>
        )}
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>{agentsUsing.length > 0 ? `${agentsUsing.length} ${agentsUsing.length > 1 ? 'agents' : 'agent'}` : 'None'}</span>
        <div style={{ width: '8px', flexShrink: 0 }} />
        {isExpanded ? <ChevronUp size={16} style={{ color: 'var(--q-text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--q-text-tertiary)' }} />}
      </div>
      {isExpanded && (
        <div style={{ padding: '0 12px 12px 12px' }}>
          <div style={{ height: '1px', backgroundColor: 'var(--q-border)', marginBottom: '8px' }} />
          {description && (
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5 }}>{description}</div>
          )}
          {/* SKILL.md chip — same style as agent file chips, click to open editor */}
          {onEdit && (
            <div onClick={onEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)', cursor: 'pointer', marginBottom: '8px' }}>
              <FileText size={14} style={{ color: 'var(--q-text-secondary)' }} />
              <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>SKILL.md</span>
            </div>
          )}
          {/* Used by section */}
          {agentsUsing.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No agent uses {name}.</span>
              <AddBtn label="Add agent" onClick={onAddAgent} />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Used by:</span>
                <AddBtn label="Add agent" onClick={onAddAgent} />
                <span style={{ flex: 1 }} />
                <button onClick={onRemoveAllAgents} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Remove all</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {agentsUsing.map(a => (
                  <div key={a} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)' }}>
                    <Bot size={16} style={{ color: 'var(--q-accent-danger)' }} />
                    <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{a}</span>
                    <button onClick={() => onRemoveAgent(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={16} style={{ color: 'var(--q-text-tertiary)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Delete skill (only for skills, at the bottom) */}
          {onDelete && (
            <div style={{ marginTop: '12px' }}>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
                <Trash size={16} onClick={onDeleteSkill} /> Delete skill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── File editor modal — exact Flutter _FileEditorDialog copy (720x600) ──
function FileEditorModal({ fileName, onClose }: { fileName: string; onClose: () => void }) {
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const mockContent = fileName === 'PROMPT.md' 
    ? 'You are Quinki Expert, a helpful coding assistant.\nYou have access to file system tools and can search the web.\nAlways be precise and concise.'
    : fileName === 'SKILL.md'
    ? '# Quinki Expert Skill\n\n## Description\nCore skill for managing dashboards.\n\n## Instructions\n1. Read the project structure\n2. Identify key files\n3. Suggest improvements'
    : `# ${fileName}\n\nFile content for ${fileName}.\nEdit this file as needed.`

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{
        backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)',
        borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '720px', height: '80vh', maxHeight: '600px',
        display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header — bgPanel with bottom border */}
        <div style={{
          padding: '10px 16px', backgroundColor: 'var(--q-bg-panel)',
          borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0,
        }}>
          <FileText size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{fileName}</span>
          <span style={{ flex: 1 }} />
          {dirty && <span style={{ color: 'var(--q-accent-warning)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginRight: '8px' }}>Unsaved</span>}
          {/* Save button */}
          <button onClick={() => { setSaving(true); setTimeout(() => { setSaving(false); setDirty(false); onClose() }, 500) }} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: saving ? 'default' : 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
            <Save size={16} /> Save
          </button>
          <div style={{ width: '8px', flexShrink: 0 }} />
          {/* X close */}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
            <X size={18} style={{ color: 'var(--q-text-secondary)' }} />
          </button>
        </div>
        {/* Editor — bgCode, fills remaining space */}
        <textarea
          defaultValue={mockContent}
          onChange={() => { if (!dirty) setDirty(true) }}
          style={{
            flex: 1, width: '100%', backgroundColor: 'var(--q-bg-code)',
            border: 'none', outline: 'none', color: 'var(--q-text)',
            fontSize: '13px', fontFamily: 'monospace', lineHeight: 1.6,
            padding: '16px', resize: 'none',
          }}
        />
      </div>
    </div>
  )
}

// ── Picker modal — exact Flutter _PickerDialog copy ──
function PickerModal({ title, items, onClose }: { title: string; items: { name: string; description: string }[]; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
  const toggle = (name: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next })
  }
  const selectAll = () => { setSelected(new Set(filtered.map(i => i.name))) }
  const deselectAll = () => { setSelected(new Set()) }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', maxWidth: '500px', maxHeight: '500px', width: '90%', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Header — title + X close */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}>
            <X size={18} style={{ color: 'var(--q-text-secondary)' }} />
          </button>
        </div>
        {/* Search */}
        <div style={{ padding: '8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' }} />
          </div>
        </div>
        {/* Items list — checkbox on RIGHT, selected items sorted to top */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.sort((a, b) => {
            const aSel = selected.has(a.name) ? 0 : 1
            const bSel = selected.has(b.name) ? 0 : 1
            return aSel - bSel
          }).map(item => {
            const isSelected = selected.has(item.name)
            return (
              <div key={item.name} onClick={() => toggle(item.name)} style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer' }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{item.name}</div>
                  {item.description && <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
                </div>
                <input type="checkbox" checked={isSelected} onChange={() => toggle(item.name)} style={{ accentColor: 'var(--q-accent-danger)', flexShrink: 0, marginLeft: '8px' }} />
              </div>
            )
          })}
        </div>
        {/* Footer — Select all + Deselect + Cancel + Add (N) */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--q-border)', display: 'flex', alignItems: 'center' }}>
          <button onClick={selectAll} disabled={filtered.length === 0} style={{ background: 'none', border: 'none', cursor: filtered.length === 0 ? 'default' : 'pointer', color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Select all</button>
          <button onClick={deselectAll} disabled={selected.size === 0} style={{ background: 'none', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Deselect</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={onClose} disabled={selected.size === 0} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', backgroundColor: selected.size === 0 ? 'transparent' : 'var(--q-accent-danger)', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)', opacity: selected.size === 0 ? 0.5 : 1 }}>Add ({selected.size})</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal ──
function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '420px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

// ── Modal actions (Cancel + Confirm) ──
function ModalActions({ onCancel, onConfirm, confirmLabel }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
      <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Cancel</button>
      <div style={{ width: '8px' }} />
      <button onClick={onConfirm} style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-danger)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>{confirmLabel}</button>
    </div>
  )
}

// ── Icon button ──
function IconBtn({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)', flexShrink: 0, padding: '0', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Icon size={20} />
    </button>
  )
}