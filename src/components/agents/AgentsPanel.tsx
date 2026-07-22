import { useState, useRef, useEffect } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Bot, Brain, FileText, Trash, Plus, ChevronDown, ChevronRight, X, Check, Pencil, Folder, FolderAdd, Wrench, Shield, Package, BookOpen } from '../icons'
import { AgentRow } from './AgentRow'
import { SkillRow } from './SkillRow'
import { AddItemsModal } from './AddItemsModal'

interface AgentsPanelProps {
  activePanel?: string
  onSelectPanel: (panel: string) => void
  agents?: any[]
}

const panelClass = "bg-bg-panel rounded-lg shadow-floating p-2 min-h-header-min flex items-center"

export function AgentsPanel(props: AgentsPanelProps) {
  const { call } = useSidecarContext()
  const [skills, setSkills] = useState<any[]>([])
  const [tools, setTools] = useState<any[]>([])
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [renamingAgent, setRenamingAgent] = useState<string | null>(null)
  const [showAddSkill, setShowAddSkill] = useState<string | null>(null)
  const [showAddTool, setShowAddTool] = useState<string | null>(null)
  const [showAddFile, setShowAddFile] = useState<string | null>(null)
  const [fileEditor, setFileEditor] = useState<{ agentId: string; fileName: string; content: string } | null>(null)
  const [showCreateSkill, setShowCreateSkill] = useState(false)
  const [showInstallSkill, setShowInstallSkill] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [installUrl, setInstallUrl] = useState('')
  const [showDeleteAgent, setShowDeleteAgent] = useState<string | null>(null)
  const [section, setSection] = useState<'agents' | 'resources' | 'plan'>('agents')

  const agents = props.agents || []
  const planTools = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'skill']

  useEffect(() => {
    if (!call) return
    call('listSkills', {}).then((r: any) => {
      if (r?.skills) setSkills(r.skills.map((s: any) => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })))
    }).catch(() => {})
    call('listTools', {}).then((r: any) => {
      if (r?.tools) setTools(r.tools.map((t: any) => ({ name: t.name || t, description: t.description || '' })))
    }).catch(() => {})
  }, [call])

  const toggleAgent = (id: string) => setExpandedAgent(expandedAgent === id ? null : id)

  const handleRename = async (id: string, newName: string) => {
    if (!call) return
    try {
      const agent = agents.find(a => a.id === id)
      if (agent) {
        await call('updateAgent', { id, config: { ...agent, name: newName } })
      }
    } catch (e) { console.error('Failed to rename agent:', e) }
  }

  const handleDeleteAgent = async (id: string) => {
    if (!call) return
    try {
      await call('deleteAgent', { id })
      setShowDeleteAgent(null)
    } catch (e) { console.error('Failed to delete agent:', e) }
  }

  const handleRemoveTag = async (agentId: string, type: string, name: string) => {
    if (!call) return
    const agent = agents.find(a => a.id === agentId)
    if (!agent) return
    try {
      if (type === 'skill') {
        await call('updateAgent', { id: agentId, config: { ...agent, skills: agent.skills.filter((s: any) => s.name !== name) } })
      } else if (type === 'tool') {
        await call('updateAgent', { id: agentId, config: { ...agent, tools: agent.tools.filter((t: any) => t.name !== name) } })
      } else if (type === 'file') {
        await call('updateAgent', { id: agentId, config: { ...agent, files: agent.files.filter((f: any) => f !== name) } })
      }
    } catch (e) { console.error('Failed to remove tag:', e) }
  }

  const handleRemoveAll = async (agentId: string, type: string) => {
    if (!call) return
    const agent = agents.find(a => a.id === agentId)
    if (!agent) return
    try {
      if (type === 'skills') await call('updateAgent', { id: agentId, config: { ...agent, skills: [] } })
      else if (type === 'tools') await call('updateAgent', { id: agentId, config: { ...agent, tools: [] } })
      else if (type === 'files') await call('updateAgent', { id: agentId, config: { ...agent, files: [] } })
    } catch (e) { console.error('Failed to remove all:', e) }
  }

  const handleOpenFile = async (agentId: string, fileName: string) => {
    if (!call) return
    try {
      const content = await call('readAgentFile', { id: agentId, filePath: fileName })
      setFileEditor({ agentId, fileName, content: content?.content || '' })
    } catch (e) { console.error('Failed to read file:', e) }
  }

  const handleSaveFile = async () => {
    if (!call || !fileEditor) return
    try {
      await call('writeAgentFile', { id: fileEditor.agentId, filePath: fileEditor.fileName, content: fileEditor.content })
      setFileEditor(null)
    } catch (e) { console.error('Failed to save file:', e) }
  }

  const handleCreateSkill = async () => {
    if (!call || !newSkillName.trim()) return
    try {
      await call('createSkill', { name: newSkillName.trim() })
      setNewSkillName('')
      setShowCreateSkill(false)
      // Refresh skills
      const r = await call('listSkills', {})
      if (r?.skills) setSkills(r.skills.map((s: any) => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })))
    } catch (e) { console.error('Failed to create skill:', e) }
  }

  const handleInstallSkill = async () => {
    if (!call || !installUrl.trim()) return
    try {
      await call('installSkill', { url: installUrl.trim() })
      setInstallUrl('')
      setShowInstallSkill(false)
      const r = await call('listSkills', {})
      if (r?.skills) setSkills(r.skills.map((s: any) => ({ name: s.name || s, description: s.description || '', source: s.source || 'local' })))
    } catch (e) { console.error('Failed to install skill:', e) }
  }

  return (
    <div className="h-full flex max-w-chat-max mx-auto w-full">
      {/* Left nav */}
      <div className="w-[220px] shrink-0 pr-2 h-full">
        <div className="h-full bg-bg-panel rounded-lg shadow-floating p-2 overflow-y-auto">
          {[
            { id: 'agents', icon: Bot, label: 'Agents' },
            { id: 'resources', icon: Package, label: 'Resources' },
            { id: 'plan', icon: Shield, label: 'Plan mode' },
          ].map(item => (
            <NavBtn key={item.id} icon={item.icon} label={item.label} active={section === item.id} onClick={() => setSection(item.id as any)} />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="h-full flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="mb-2 shrink-0 flex items-center">
          <div className={panelClass}>
            <IconButton icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
          </div>
          <div className="w-2 shrink-0" />
          <div className={panelClass + " flex-1"}>
            <div className="w-2 shrink-0" />
            {section === 'agents' && <Bot size={18} className="text-text-secondary shrink-0" />}
            {section === 'resources' && <Package size={18} className="text-text-secondary shrink-0" />}
            {section === 'plan' && <Shield size={18} className="text-text-secondary shrink-0" />}
            <div className="w-3 shrink-0" />
            <span className="text-text text-16 font-semibold font-interface">
              {section === 'agents' ? 'Agents' : section === 'resources' ? 'Resources' : 'Plan mode'}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto pt-px pr-4 pl-4" style={{ scrollbarGutter: 'stable' }}>
          {section === 'agents' && (
            <>
              {agents.map(agent => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  isExpanded={expandedAgent === agent.id}
                  isRenaming={renamingAgent === agent.id}
                  onToggle={() => toggleAgent(agent.id)}
                  onStartRename={() => setRenamingAgent(agent.id)}
                  onCommitRename={() => { if (renamingAgent) handleRename(renamingAgent, document.querySelector<HTMLInputElement>(`input[data-agent="${renamingAgent}"]`)?.value || ''); setRenamingAgent(null) }}
                  skills={skills}
                  tools={tools}
                  onShowDelete={() => setShowDeleteAgent(agent.id)}
                  onAddFile={() => setShowAddFile(agent.id)}
                  onAddSkill={() => setShowAddSkill(agent.id)}
                  onAddTool={() => setShowAddTool(agent.id)}
                  onOpenFile={(file) => handleOpenFile(agent.id, file)}
                  onRemoveTag={(type, name) => handleRemoveTag(agent.id, type, name)}
                  onRemoveAll={(type) => handleRemoveAll(agent.id, type)}
                />
              ))}

              {/* Delete agent modal */}
              {showDeleteAgent && (
                <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowDeleteAgent(null)}>
                  <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
                    <div className="text-text text-16 font-interface mb-2">Delete agent?</div>
                    <div className="text-text-tertiary text-13 font-interface mb-5">This will permanently delete the agent and all its files.</div>
                    <div className="flex justify-end items-center">
                      <button className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface" onClick={() => setShowDeleteAgent(null)}>Cancel</button>
                      <div className="w-2" />
                      <button className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-primary text-bg text-15 font-medium font-interface" onClick={() => handleDeleteAgent(showDeleteAgent)}>Delete</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {section === 'resources' && (
            <>
              {/* Skills */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-text text-16 font-semibold font-interface">Skills</span>
                  <button onClick={() => setShowCreateSkill(true)} className="px-2 py-1 rounded-md border border-border text-13 font-interface cursor-pointer bg-transparent text-text-secondary">+ Create</button>
                  <button onClick={() => setShowInstallSkill(true)} className="px-2 py-1 rounded-md border border-border text-13 font-interface cursor-pointer bg-transparent text-text-secondary">+ Install from GitHub</button>
                </div>
                {skills.map(skill => (
                  <SkillRow
                    key={skill.name}
                    icon={FileText}
                    name={skill.name}
                    description={skill.description}
                    agentsUsing={agents.filter(a => a.skills?.some((s: any) => s.name === skill.name)).map(a => a.name)}
                  />
                ))}
                {skills.length === 0 && <div className="text-text-tertiary text-14 font-interface py-4">No skills installed.</div>}
              </div>

              {/* Tools */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-text text-16 font-semibold font-interface">Tools</span>
                </div>
                {tools.map(tool => (
                  <SkillRow
                    key={tool.name}
                    icon={Wrench}
                    name={tool.name}
                    description={tool.description}
                    agentsUsing={agents.filter(a => a.tools?.some((t: any) => t.name === tool.name)).map(a => a.name)}
                  />
                ))}
                {tools.length === 0 && <div className="text-text-tertiary text-14 font-interface py-4">No tools available.</div>}
              </div>
            </>
          )}

          {section === 'plan' && (
            <div className="bg-bg-panel rounded-lg shadow-floating p-4 mb-3">
              <div className="text-text text-15 font-semibold font-interface mb-2">Plan mode tools</div>
              <div className="text-text-tertiary text-13 font-interface mb-3">Tools available when agents are in Plan mode.</div>
              <div className="flex flex-wrap gap-1.5">
                {planTools.map(tool => (
                  <div key={tool} className="inline-flex items-center gap-1.5 p-1.5 px-3 rounded-md border-none" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-primary)' }} />
                    <span className="text-text text-14 font-interface">{tool}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add skill modal */}
      {showAddSkill && (
        <AddItemsModal
          title="Add skill to agent"
          items={skills.filter(s => !agents.find(a => a.id === showAddSkill)?.skills?.some((as: any) => as.name === s.name)).map(s => ({ name: s.name, description: s.description }))}
          onClose={() => setShowAddSkill(null)}
        />
      )}

      {/* Add tool modal */}
      {showAddTool && (
        <AddItemsModal
          title="Add tool to agent"
          items={tools.filter(t => !agents.find(a => a.id === showAddTool)?.tools?.some((at: any) => at.name === t.name)).map(t => ({ name: t.name, description: t.description }))}
          onClose={() => setShowAddTool(null)}
        />
      )}

      {/* File editor modal */}
      {fileEditor && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setFileEditor(null)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter w-[90%] max-w-[700px] h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 px-4 border-b border-border flex items-center">
              <FileText size={18} className="text-accent-info shrink-0" />
              <div className="w-2 shrink-0" />
              <span className="text-text text-16 font-semibold font-interface">{fileEditor.fileName}</span>
              <span className="flex-1" />
              <button onClick={() => setFileEditor(null)} className="bg-none border-none cursor-pointer p-0 flex">
                <X size={18} className="text-text-secondary" />
              </button>
            </div>
            <textarea
              value={fileEditor.content}
              onChange={(e) => setFileEditor({ ...fileEditor, content: e.target.value })}
              className="flex-1 bg-bg-code text-text text-13 font-code p-4 border-none outline-none resize-none overflow-auto"
              style={{ lineHeight: 1.6 }}
            />
            <div className="p-2 px-4 border-t border-border flex justify-end">
              <button onClick={handleSaveFile} className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-primary text-bg text-15 font-medium font-interface">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Create skill dialog */}
      {showCreateSkill && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowCreateSkill(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-16 font-interface mb-2">Create new skill</div>
            <input type="text" placeholder="skill-name" value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)} autoFocus className="w-full h-9 bg-bg-elevated border border-border rounded-md text-text text-14 font-interface px-3 outline-none mb-4" />
            <div className="flex justify-end">
              <button onClick={() => setShowCreateSkill(false)} className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface">Cancel</button>
              <div className="w-2" />
              <button onClick={handleCreateSkill} className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-primary text-bg text-15 font-medium font-interface">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Install skill dialog */}
      {showInstallSkill && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowInstallSkill(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[500px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-16 font-interface mb-2">Install skill from GitHub</div>
            <input type="text" placeholder="https://github.com/user/skill-repo" value={installUrl} onChange={(e) => setInstallUrl(e.target.value)} autoFocus className="w-full h-9 bg-bg-elevated border border-border rounded-md text-text text-14 font-interface px-3 outline-none mb-4" />
            <div className="flex justify-end">
              <button onClick={() => setShowInstallSkill(false)} className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface">Cancel</button>
              <div className="w-2" />
              <button onClick={handleInstallSkill} className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-primary text-bg text-15 font-medium font-interface">Install</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NavBtn({ icon: Icon, label, active, onClick }: { icon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>; label: string; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="p-2 px-3 mb-0.5 rounded-lg cursor-pointer flex items-center gap-2"
      style={{
        backgroundColor: hovered ? 'rgba(157, 139, 217, 0.10)' : 'transparent',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <Icon size={20} className="shrink-0" style={{ color: hovered ? 'var(--q-accent-primary)' : 'var(--q-text-secondary)' }} />
      <span className="text-14 font-interface overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)' }}>{label}</span>
    </div>
  )
}

function IconButton({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; className?: string }>; onClick?: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms, transform 120ms',
      }}>
      <Icon size={20} />
    </button>
  )
}