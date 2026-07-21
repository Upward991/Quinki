import { useState } from 'react'
import { Bot, Brain, ChevronDown, ChevronUp, FileText, Trash, Pencil, X } from '../icons'

interface AgentFile {
  name: string
}

interface AgentSkill {
  name: string
}

interface AgentTool {
  name: string
}

interface Agent {
  id: string
  name: string
  files: AgentFile[]
  skills: AgentSkill[]
  tools: AgentTool[]
  isDeletable?: boolean
}

interface AgentRowProps {
  agent: Agent
  isExpanded: boolean
  isRenaming: boolean
  onToggle: () => void
  onStartRename: () => void
  onCommitRename: () => void
  skills: any[]
  tools: any[]
  onShowDelete?: () => void
  onAddFile?: () => void
  onAddSkill?: () => void
  onAddTool?: () => void
  onOpenFile?: (file: string) => void
  onRemoveTag?: (type: string, name: string) => void
  onRemoveAll?: (type: string) => void
}

export function AgentRow(props: AgentRowProps) {
  const { agent, isExpanded, isRenaming, onToggle, onStartRename, onCommitRename, skills, tools, onShowDelete, onAddFile, onAddSkill, onAddTool, onOpenFile, onRemoveTag, onRemoveAll } = props
  const agentSkills = skills.filter(s => agent.skills.some(as => as.name === s.name))
  const agentTools = tools.filter(t => agent.tools.some(at => at.name === t.name))
  const canDelete = agent.id !== 'quinki-expert' && agent.id !== 'orchestrator'

  return (
    <div className="mb-1 bg-bg-elevated border-none rounded-lg overflow-hidden">
      {/* Header */}
      <div
        onClick={onToggle}
        className="p-2.5 px-3 flex items-center cursor-pointer rounded-lg"
        style={{ transition: 'background-color 120ms ease' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(201, 112, 132, 0.03)' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        <Bot size={16} className="text-accent-secondary shrink-0" />
        <div className="w-2 shrink-0" />
        {isRenaming ? (
          <input
            type="text"
            defaultValue={agent.name}
            autoFocus
            onBlur={onCommitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') onCommitRename() }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-text text-14 font-semibold font-interface bg-transparent border-none outline-none p-0"
          />
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-text text-14 font-semibold font-interface overflow-hidden text-ellipsis whitespace-nowrap">
              {agent.name}
            </span>
            {canDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onStartRename() }}
                className="bg-none border-none cursor-pointer p-0 flex shrink-0"
              >
                <Pencil size={13} className="text-text-tertiary" />
              </button>
            )}
          </div>
        )}
        <span className="text-text-tertiary text-12 font-interface shrink-0">
          {agentSkills.length} skill · {agentTools.length} tool
        </span>
        <div className="w-2 shrink-0" />
        {isExpanded ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div className="px-3 pb-3 pl-3.5">
          {/* Files */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-text text-14 font-interface">File ({agent.files.length})</span>
            <AddBtn label="Add file" onClick={onAddFile} />
            {agent.files.length > 0 && (
              <>
                <span className="flex-1" />
                <button onClick={() => onRemoveAll?.('files')} className="bg-none border-none cursor-pointer text-text-tertiary text-13 font-interface">
                  Remove all
                </button>
              </>
            )}
          </div>
          {agent.files.length === 0 ? (
            <span className="text-text-tertiary text-13 font-interface">No files.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {agent.files.map((file: AgentFile) => (
                <div
                  key={file.name}
                  onClick={() => onOpenFile?.(file.name)}
                  className="inline-flex items-center gap-1.5 p-1.5 px-2 rounded-md border-none cursor-pointer"
                  style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
                >
                  <FileText size={14} className="text-text-secondary" />
                  <span className="text-text text-13 font-interface">{file.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveTag?.('file', file.name) }}
                    className="bg-none border-none cursor-pointer p-0 flex"
                  >
                    <X size={14} className="text-text-tertiary" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Skills */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-text text-14 font-interface">Skill ({agentSkills.length})</span>
            <AddBtn label="Add skill" onClick={onAddSkill} />
            {agentSkills.length > 0 && (
              <>
                <span className="flex-1" />
                <button onClick={() => onRemoveAll?.('skills')} className="bg-none border-none cursor-pointer text-text-tertiary text-13 font-interface">
                  Remove all
                </button>
              </>
            )}
          </div>
          {agentSkills.length === 0 ? (
            <span className="text-text-tertiary text-13 font-interface">No skill assigned.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {agentSkills.map((skill: any) => (
                <Chip key={skill.name} icon={FileText} label={skill.name} onRemove={() => onRemoveTag?.('skill', skill.name)} />
              ))}
            </div>
          )}

          {/* Tools */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-text text-14 font-interface">Tool ({agentTools.length})</span>
            <AddBtn label="Add tool" onClick={onAddTool} />
            {agentTools.length > 0 && (
              <>
                <span className="flex-1" />
                <button onClick={() => onRemoveAll?.('tools')} className="bg-none border-none cursor-pointer text-text-tertiary text-13 font-interface">
                  Remove all
                </button>
              </>
            )}
          </div>
          {agentTools.length === 0 ? (
            <span className="text-text-tertiary text-13 font-interface">No tool assigned.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {agentTools.map((tool: any) => (
                <Chip key={tool.name} icon={Brain} label={tool.name} onRemove={() => onRemoveTag?.('tool', tool.name)} />
              ))}
            </div>
          )}

          {/* Delete */}
          {agent.isDeletable && (
            <div className="mt-4">
              <button
                onClick={onShowDelete}
                className="flex items-center gap-1.5 p-0 border-none cursor-pointer bg-transparent text-accent-danger text-14 font-interface"
              >
                <Trash size={16} />
                Delete agent
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="px-2 py-1 rounded-md border text-13 font-interface cursor-pointer"
      style={{
        borderColor: hovered ? 'var(--q-accent-secondary)' : 'var(--q-border)',
        color: hovered ? 'var(--q-accent-secondary)' : 'var(--q-text-secondary)',
        backgroundColor: hovered ? 'var(--q-accent-secondary)' : 'transparent',
        transition: 'all 120ms ease',
      }}
    >
      + {label}
    </button>
  )
}

function Chip({ icon: Icon, label, onRemove }: { icon: React.FC<{ size?: number; className?: string }>; label: string; onRemove: () => void }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 p-1.5 px-3 rounded-md border-none"
      style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
    >
      <Icon size={14} className="text-text-secondary" />
      <span className="text-text text-14 font-interface">{label}</span>
      <button onClick={onRemove} className="bg-none border-none cursor-pointer p-0 flex">
        <X size={14} className="text-text-tertiary" />
      </button>
    </div>
  )
}