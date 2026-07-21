import { useState } from 'react'
import { ChevronUp, ChevronDown, FileText, Bot, Trash, X } from '../icons'

interface SkillRowProps {
  icon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>
  name: string
  description?: string
  agentsUsing: string[]
  badge?: string
  badgeColor?: string
  isExpanded?: boolean
  onToggle?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onAddAgent?: () => void
  onRemoveAgent?: (agent: string) => void
  onRemoveAllAgents?: () => void
  onDeleteSkill?: () => void
}

export function SkillRow(props: SkillRowProps) {
  const { icon: Icon, name, description, agentsUsing, badge, badgeColor, isExpanded, onToggle, onEdit, onDelete, onAddAgent, onRemoveAgent, onRemoveAllAgents, onDeleteSkill } = props

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
        <Icon size={16} className="text-text-secondary shrink-0" />
        <div className="w-2 shrink-0" />
        <span className="text-text text-14 font-interface flex-1">{name}</span>
        {badge && badgeColor && (
          <>
            <span
              className="px-1.5 rounded-sm text-11 font-interface"
              style={{
                backgroundColor: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
                color: badgeColor,
              }}
            >
              {badge}
            </span>
            <div className="w-2 shrink-0" />
          </>
        )}
        <span className="text-text-tertiary text-12 font-interface">
          {agentsUsing.length > 0 ? `${agentsUsing.length} ${agentsUsing.length > 1 ? 'agents' : 'agent'}` : 'None'}
        </span>
        <div className="w-2 shrink-0" />
        {isExpanded ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
      </div>

      {/* Expanded */}
      {isExpanded && (
        <div className="px-3 pb-3 pl-3.5">
          {description && (
            <div className="text-text-tertiary text-12 font-interface mb-2 leading-relaxed">
              {description}
            </div>
          )}
          {onEdit && (
            <div
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 p-1.5 px-2 rounded-md border-none cursor-pointer mb-2"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
            >
              <FileText size={14} className="text-text-secondary" />
              <span className="text-text text-13 font-interface">SKILL.md</span>
            </div>
          )}
          {agentsUsing.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-text-tertiary text-13 font-interface">No agent uses {name}.</span>
              <AddButton label="Add agent" onClick={onAddAgent} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-text text-14 font-interface">Used by:</span>
                <AddButton label="Add agent" onClick={onAddAgent} />
                <span className="flex-1" />
                <button
                  onClick={onRemoveAllAgents}
                  className="bg-none border-none cursor-pointer text-text-tertiary text-13 font-interface"
                >
                  Remove all
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {agentsUsing.map((agent: string) => (
                  <div
                    key={agent}
                    className="flex items-center gap-1.5 p-1.5 px-3 rounded-md border-none"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
                  >
                    <Bot size={16} className="text-accent-secondary" />
                    <span className="text-text text-14 font-interface">{agent}</span>
                    <button
                      onClick={() => onRemoveAgent?.(agent)}
                      className="bg-none border-none cursor-pointer p-0 w-6 h-6 flex items-center justify-center"
                    >
                      <X size={16} className="text-text-tertiary" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {onDelete && (
            <div className="mt-3">
              <button
                className="flex items-center gap-1.5 p-0 border-none cursor-pointer bg-transparent text-accent-danger text-14 font-interface"
              >
                <Trash size={16} onClick={onDeleteSkill} />
                Delete skill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick?: () => void }) {
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