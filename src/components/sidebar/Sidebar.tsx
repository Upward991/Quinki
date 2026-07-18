// ============================================================
// Sidebar — exact Flutter copy + DnD matching original
// DnD: LongPress to start drag, feedback widget with shadow,
//   Folder: 15% before, 70% into (orange highlight), 15% after
//   Chat: 50% before, 50% after
//   Insertion lines: blue (accentInfoBright), depth-aware
//   Dragging item: 15% opacity
// ============================================================

import { useState } from 'react'
import type { Session } from '../../types'
import { MessageSquarePlus, FolderPlus, MessageSquare, Folder, FolderOpen } from '../icons'

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onToggleFolder: (id: string) => void
  onReorder?: (sessions: Session[]) => void
  welcomeMode?: boolean
}

type DropZone = 'before' | 'after' | 'into'

interface DragItem {
  id: string
  kind: 'chat' | 'folder'
}

export function Sidebar({ sessions, activeSessionId, onSelectSession, onNewSession, onToggleFolder, onReorder, welcomeMode }: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverNewChat, setHoverNewChat] = useState(false)
  const [hoverNewFolder, setHoverNewFolder] = useState(false)
  const [flashNewChat, setFlashNewChat] = useState(false)
  const [flashNewFolder, setFlashNewFolder] = useState(false)
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropZone, setDropZone] = useState<{ id: string; zone: DropZone } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: Session } | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  const [bottomDropActive, setBottomDropActive] = useState(false)

  // Build flat list with depth — supports nested folders
  const flatItems: { item: Session; depth: number }[] = []
  const topLevel = sessions.filter(s => !s.parentId)
  for (const item of topLevel) {
    if (item.type === 'folder') {
      flatItems.push({ item, depth: 0 })
      if (item.isExpanded) {
        const children = sessions.filter(s => s.parentId === item.id)
        for (const child of children) {
          if (child.type === 'folder') {
            flatItems.push({ item: child, depth: 1 })
            if (child.isExpanded) {
              const grandchildren = sessions.filter(s => s.parentId === child.id)
              for (const grandchild of grandchildren) {
                flatItems.push({ item: grandchild, depth: 2 })
              }
            }
          } else {
            flatItems.push({ item: child, depth: 1 })
          }
        }
      }
    } else {
      flatItems.push({ item, depth: 0 })
    }
  }

  // Anti-cycle check
  const isDescendant = (targetId: string, folderId: string): boolean => {
    const children = sessions.filter(s => s.parentId === folderId)
    for (const child of children) {
      if (child.id === targetId) return true
      if (child.type === 'folder' && isDescendant(targetId, child.id)) return true
    }
    return false
  }

  const canAccept = (drag: DragItem, targetId: string): boolean => {
    if (drag.id === targetId) return false
    if (drag.kind === 'folder' && isDescendant(targetId, drag.id)) return false
    return true
  }

  // Compute drop zone based on cursor position — matches Flutter exactly
  const computeZone = (localY: number, height: number, isFolder: boolean): DropZone => {
    if (isFolder) {
      // Folder: 15% before, 70% into, 15% after
      if (localY < height * 0.15) return 'before'
      if (localY > height * 0.85) return 'after'
      return 'into'
    }
    // Chat: 50% before, 50% after
    return localY < height * 0.5 ? 'before' : 'after'
  }

  const handleDrop = (targetId: string, zone: DropZone) => {
    if (!dragItem) return
    const target = sessions.find(s => s.id === targetId)
    if (!target || !canAccept(dragItem, targetId)) return

    const newSessions = [...sessions]
    const dragIdx = newSessions.findIndex(s => s.id === dragItem.id)
    if (dragIdx === -1) return
    const [dragged] = newSessions.splice(dragIdx, 1)

    if (zone === 'into' && target.type === 'folder') {
      dragged.parentId = targetId
      // Insert right after the target folder (and its children)
      const targetIdx = newSessions.findIndex(s => s.id === targetId)
      // Find the last child of target
      let insertIdx = targetIdx + 1
      while (insertIdx < newSessions.length && newSessions[insertIdx].parentId === targetId) {
        insertIdx++
      }
      newSessions.splice(insertIdx, 0, dragged)
    } else if (zone === 'before') {
      dragged.parentId = target.parentId
      const targetIdx = newSessions.findIndex(s => s.id === targetId)
      newSessions.splice(targetIdx, 0, dragged)
    } else if (zone === 'after') {
      dragged.parentId = target.parentId
      const targetIdx = newSessions.findIndex(s => s.id === targetId)
      newSessions.splice(targetIdx + 1, 0, dragged)
    }

    onReorder?.(newSessions)
    setDragItem(null)
    setDropZone(null)
  }

  const handleDropRoot = () => {
    if (!dragItem) return
    const newSessions = [...sessions]
    const dragIdx = newSessions.findIndex(s => s.id === dragItem.id)
    if (dragIdx === -1) return
    const [dragged] = newSessions.splice(dragIdx, 1)
    dragged.parentId = undefined
    newSessions.push(dragged)
    onReorder?.(newSessions)
    setDragItem(null)
    setDropZone(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => { onNewSession(); setFlashNewChat(true); setTimeout(() => setFlashNewChat(false), 600) }}
            onMouseEnter={() => setHoverNewChat(true)}
            onMouseLeave={() => setHoverNewChat(false)}
            style={{
              flex: 1, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
              backgroundColor: welcomeMode || hoverNewChat ? 'var(--q-hover)' : 'transparent',
              color: welcomeMode ? 'var(--q-accent-info)' : flashNewChat ? 'var(--q-accent-primary)' : hoverNewChat ? 'var(--q-text)' : 'var(--q-text-secondary)',
              padding: '0', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
            }}
          >
            <MessageSquarePlus size={20} />
          </button>
          <button
            onClick={() => { setFlashNewFolder(true); setTimeout(() => setFlashNewFolder(false), 600) }}
            onMouseEnter={() => setHoverNewFolder(true)}
            onMouseLeave={() => setHoverNewFolder(false)}
            style={{
              width: '40px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
              backgroundColor: hoverNewFolder ? 'var(--q-hover)' : 'transparent',
              color: flashNewFolder ? 'var(--q-accent-folder-open)' : hoverNewFolder ? 'var(--q-text)' : 'var(--q-text-secondary)',
              padding: '0', flexShrink: 0,
              transform: hoverNewFolder ? 'scale(1.02)' : 'scale(1)',
              transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease, transform 120ms ease',
            }}
          >
            <FolderPlus size={20} />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {flatItems.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
            No chats
          </div>
        ) : (
          <>
            {flatItems.map(({ item, depth }) => {
              const isActive = item.id === activeSessionId
              const isHovered = hoveredId === item.id
              const isFolder = item.type === 'folder'
              const folderExpanded = isFolder && item.isExpanded
              const isDragging = dragItem?.id === item.id
              const isSelected = multiSelect && selectedForRemoval.has(item.id)
              const currentDropZone = dropZone?.id === item.id ? dropZone.zone : null

              const folderColor = 'var(--q-accent-folder-open)'
              const textColor = isFolder
                ? (folderExpanded ? folderColor : isHovered ? 'var(--q-text)' : 'var(--q-text-secondary)')
                : (isSelected ? 'var(--q-accent-danger)' : isActive ? 'var(--q-accent-info-bright)' : isHovered ? 'var(--q-text)' : 'var(--q-text-secondary)')
              const iconColor = isFolder
                ? (folderExpanded ? folderColor : isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)')
                : (isSelected ? 'var(--q-accent-danger)' : isActive ? 'var(--q-accent-info-bright)' : isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)')
              const bgColor = isHovered ? 'var(--q-hover)' : 'transparent'

              return (
                <div
                  key={item.id}
                  style={{ paddingLeft: '8px', paddingRight: '8px', paddingBottom: '4px', position: 'relative' }}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Insertion line: before (blue, depth-aware) */}
                  {currentDropZone === 'before' && (
                    <div style={{
                      position: 'absolute', top: '-1px', left: `${8 + depth * 12}px`, right: '8px',
                      height: '3px', backgroundColor: 'var(--q-accent-info-bright)', borderRadius: '1.5px',
                      zIndex: 10, pointerEvents: 'none',
                    }} />
                  )}

                  {/* Insertion line: after (blue, depth-aware) */}
                  {currentDropZone === 'after' && (
                    <div style={{
                      position: 'absolute', bottom: '1px', left: `${8 + depth * 12}px`, right: '8px',
                      height: '3px', backgroundColor: 'var(--q-accent-info-bright)', borderRadius: '1.5px',
                      zIndex: 10, pointerEvents: 'none',
                    }} />
                  )}

                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragItem({ id: item.id, kind: isFolder ? 'folder' : 'chat' })
                      e.dataTransfer.effectAllowed = 'move'
                      // Try to set a transparent drag image (browser-dependent)
                      try {
                        const img = new Image()
                        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                        e.dataTransfer.setDragImage(img, 0, 0)
                      } catch {}
                    }}
                    onDragEnd={() => { setDragItem(null); setDropZone(null); setBottomDropActive(false) }}
                    onDragOver={(e) => {
                      if (!dragItem || !canAccept(dragItem, item.id)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      const localY = e.clientY - rect.top
                      const zone = computeZone(localY, rect.height, isFolder)
                      if (dropZone?.id !== item.id || dropZone?.zone !== zone) {
                        setDropZone({ id: item.id, zone })
                      }
                    }}
                    onDragLeave={(e) => {
                      // Only clear if leaving to a different element
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = e.clientX, y = e.clientY
                      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                        if (dropZone?.id === item.id) setDropZone(null)
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (!dragItem) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const localY = e.clientY - rect.top
                      const zone = computeZone(localY, rect.height, isFolder)
                      handleDrop(item.id, zone)
                    }}
                    onClick={() => {
                      if (multiSelect && !isFolder) {
                        const s = new Set(selectedForRemoval)
                        if (s.has(item.id)) s.delete(item.id); else s.add(item.id)
                        setSelectedForRemoval(s)
                      } else {
                        isFolder ? onToggleFolder(item.id) : onSelectSession(item.id)
                      }
                    }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, item }) }}
                    style={{
                      paddingLeft: `${depth * 12 + 8}px`,
                      paddingRight: '8px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      minHeight: '32px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: currentDropZone === 'into'
                        ? 'var(--q-accent-folder-open-soft)'
                        : bgColor,
                      border: currentDropZone === 'into'
                        ? '2px solid var(--q-accent-folder-open-border)'
                        : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isDragging ? 0.15 : 1,
                      boxSizing: 'border-box',
                      transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    {isFolder ? (
                      folderExpanded ? (
                        <FolderOpen size={20} style={{ color: iconColor, flexShrink: 0 }} />
                      ) : (
                        <Folder size={20} style={{ color: iconColor, flexShrink: 0 }} />
                      )
                    ) : (
                      <MessageSquare size={20} style={{ color: iconColor, flexShrink: 0 }} />
                    )}
                    <span style={{
                      color: textColor, fontSize: '14px', fontFamily: 'var(--font-interface)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '20px',
                    }}>
                      {item.title || 'Chat'}
                    </span>
                    {item.unread && !isActive && (
                      <span style={{
                        backgroundColor: 'var(--q-text)', color: 'var(--q-bg)',
                        fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-interface)',
                        borderRadius: '999px', padding: '4px 8px', minWidth: '18px',
                        textAlign: 'center', flexShrink: 0, lineHeight: '1',
                      }}>
                        {item.messageCount || 0}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Bottom drop zone — root level */}
            <div
              style={{ height: '20px', padding: '0 8px' }}
              onDragOver={(e) => {
                if (!dragItem) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setBottomDropActive(true)
              }}
              onDragLeave={() => setBottomDropActive(false)}
              onDrop={(e) => { e.preventDefault(); handleDropRoot() }}
            >
              {bottomDropActive && (
                <div style={{
                  height: '3px', backgroundColor: 'var(--q-accent-info-bright)', borderRadius: '1.5px',
                  margin: '0 8px',
                }} />
              )}
            </div>
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <SidebarContextMenu
          x={ctxMenu.x} y={ctxMenu.y} item={ctxMenu.item}
          onClose={() => setCtxMenu(null)}
          onRename={() => {}}
          onOpenWindow={() => {}}
          onDelete={() => {
            if (ctxMenu.item.type === 'folder') {
              onReorder?.(sessions.filter(s => s.id !== ctxMenu.item.id && s.parentId !== ctxMenu.item.id))
            } else {
              onReorder?.(sessions.filter(s => s.id !== ctxMenu.item.id))
            }
          }}
          multiSelect={multiSelect}
          selectedForRemoval={selectedForRemoval}
          setMultiSelect={setMultiSelect}
          setSelectedForRemoval={setSelectedForRemoval}
          onReorder={onReorder}
          sessions={sessions}
        />
      )}
    </div>
  )
}

// ── Sidebar Context Menu ──
function SidebarContextMenu({ x, y, item, onClose, onRename, onOpenWindow, onDelete, multiSelect, selectedForRemoval, setMultiSelect, setSelectedForRemoval, onReorder, sessions }: {
  x: number; y: number; item: Session; onClose: () => void
  onRename: () => void; onOpenWindow: () => void; onDelete: () => void
  multiSelect: boolean; selectedForRemoval: Set<string>
  setMultiSelect: (v: boolean) => void; setSelectedForRemoval: (v: Set<string>) => void
  onReorder?: (sessions: Session[]) => void; sessions: Session[]
}) {
  const isFolder = item.type === 'folder'
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div style={{
        position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 250),
        zIndex: 210, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: '180px',
      }}>
        {multiSelect ? (
          <>
            <CtxMenuItem label="Deselect all" onClick={() => { setMultiSelect(false); setSelectedForRemoval(new Set()); onClose() }} />
            {selectedForRemoval.size > 0 && <CtxMenuItem label={`Delete ${selectedForRemoval.size} chat${selectedForRemoval.size > 1 ? 'es' : ''}`} color="var(--q-accent-danger)" onClick={() => { onReorder?.(sessions.filter(s => !selectedForRemoval.has(s.id))); setMultiSelect(false); setSelectedForRemoval(new Set()); onClose() }} />}
          </>
        ) : (
          <>
            <CtxMenuItem label="Rename" onClick={() => { onRename(); onClose() }} />
            {!isFolder && <CtxMenuItem label="Select chat" onClick={() => { setMultiSelect(true); setSelectedForRemoval(new Set([item.id])); onClose() }} />}
            {!isFolder && <CtxMenuItem label="Open in separate window" onClick={() => { onOpenWindow(); onClose() }} />}
            {isFolder && <CtxMenuItem label="New subfolder" onClick={() => { onClose() }} />}
            <CtxMenuItem label={isFolder ? 'Delete folder' : 'Delete chat'} color="var(--q-accent-danger)" onClick={() => { onDelete(); onClose() }} />
            {isFolder && <CtxMenuItem label="Delete folder with contents" color="var(--q-accent-danger)" onClick={() => {
              // Delete folder + all descendants recursively
              const toDelete = new Set<string>([item.id])
              let changed = true
              while (changed) {
                changed = false
                for (const s of sessions) {
                  if (s.parentId && toDelete.has(s.parentId) && !toDelete.has(s.id)) {
                    toDelete.add(s.id)
                    changed = true
                  }
                }
              }
              onReorder?.(sessions.filter(s => !toDelete.has(s.id)))
              onClose()
            }} />}
          </>
        )}
      </div>
    </>
  )
}

function CtxMenuItem({ label, color, onClick }: { label: string; color?: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px',
        border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: color || 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)',
        textAlign: 'left',
      }}
    >
      {label}
    </button>
  )
}