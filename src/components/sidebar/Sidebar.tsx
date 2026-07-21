import { useState } from 'react'
import { Folder, FolderOpen, MessageSquare, MessageSquarePlus, FolderAdd } from '../icons'

interface Session {
  id: string
  title?: string
  type?: string
  parentId?: string
  isExpanded?: boolean
  unread?: boolean
  messageCount?: number
  kind?: string
}

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onToggleFolder: (id: string) => void
  onReorder: (sessions: Session[]) => void
  welcomeMode?: boolean
}

export function Sidebar({ sessions, activeSessionId, onSelectSession, onNewSession, onToggleFolder, onReorder, welcomeMode }: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [newChatHover, setNewChatHover] = useState(false)
  const [newFolderHover, setNewFolderHover] = useState(false)
  const [newChatPulse, setNewChatPulse] = useState(false)
  const [newFolderPulse, setNewFolderPulse] = useState(false)
  const [dragItem, setDragItem] = useState<any>(null)
  const [dropZone, setDropZone] = useState<{ id: string; zone: string } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: Session } | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  const [showDropZone, setShowDropZone] = useState(false)

  // Build flat list with depth
  const flatList: { item: Session; depth: number }[] = []
  const topLevel = sessions.filter(s => !s.parentId)
  for (const item of topLevel) {
    if (item.type === 'folder') {
      flatList.push({ item, depth: 0 })
      if (item.isExpanded) {
        const children = sessions.filter(s => s.parentId === item.id)
        for (const child of children) {
          if (child.type === 'folder') {
            flatList.push({ item: child, depth: 1 })
            if (child.isExpanded) {
              const grandchildren = sessions.filter(s => s.parentId === child.id)
              for (const gc of grandchildren) flatList.push({ item: gc, depth: 2 })
            }
          } else {
            flatList.push({ item: child, depth: 1 })
          }
        }
      }
    } else {
      flatList.push({ item, depth: 0 })
    }
  }

  const isDescendant = (id: string, parentId: string): boolean => {
    const children = sessions.filter(s => s.parentId === parentId)
    for (const child of children) {
      if (child.id === id || (child.type === 'folder' && isDescendant(id, child.id))) return true
    }
    return false
  }

  const canDrop = (drag: any, targetId: string): boolean => {
    return !(drag.id === targetId || (drag.kind === 'folder' && isDescendant(targetId, drag.id)))
  }

  const getDropZone = (offset: number, height: number, isFolder: boolean): string => {
    if (isFolder) return offset < height * 0.15 ? 'before' : offset > height * 0.85 ? 'after' : 'into'
    return offset < height * 0.5 ? 'before' : 'after'
  }

  const handleDrop = (targetId: string, zone: string) => {
    if (!dragItem) return
    const target = sessions.find(s => s.id === targetId)
    if (!target || !canDrop(dragItem, targetId)) return
    const arr = [...sessions]
    const dragIdx = arr.findIndex(s => s.id === dragItem.id)
    if (dragIdx === -1) return
    const [dragged] = arr.splice(dragIdx, 1)
    if (zone === 'into' && target.type === 'folder') {
      dragged.parentId = targetId
      let insertIdx = arr.findIndex(s => s.id === targetId) + 1
      while (insertIdx < arr.length && arr[insertIdx].parentId === targetId) insertIdx++
      arr.splice(insertIdx, 0, dragged)
    } else if (zone === 'before') {
      dragged.parentId = target.parentId
      arr.splice(arr.findIndex(s => s.id === targetId), 0, dragged)
    } else if (zone === 'after') {
      dragged.parentId = target.parentId
      arr.splice(arr.findIndex(s => s.id === targetId) + 1, 0, dragged)
    }
    onReorder?.(arr)
    setDragItem(null)
    setDropZone(null)
  }

  const handleDropToEnd = () => {
    if (!dragItem) return
    const arr = [...sessions]
    const idx = arr.findIndex(s => s.id === dragItem.id)
    if (idx === -1) return
    const [dragged] = arr.splice(idx, 1)
    dragged.parentId = undefined
    arr.push(dragged)
    onReorder?.(arr)
    setDragItem(null)
    setDropZone(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* New chat / folder buttons */}
      <div className="p-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { onNewSession(); setNewChatPulse(true); setTimeout(() => setNewChatPulse(false), 600) }}
            onMouseEnter={() => setNewChatHover(true)}
            onMouseLeave={() => setNewChatHover(false)}
            className="flex-1 h-8 flex items-center justify-center rounded-md border-none cursor-pointer p-0"
            style={{
              backgroundColor: welcomeMode || newChatHover ? 'var(--q-hover)' : 'transparent',
              color: welcomeMode ? 'var(--q-accent-info)' : newChatPulse ? 'var(--q-accent-primary)' : newChatHover ? 'var(--q-text)' : 'var(--q-text-secondary)',
              transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
            }}
          >
            <MessageSquarePlus size={20} />
          </button>
          <button
            onClick={() => { setNewFolderPulse(true); setTimeout(() => setNewFolderPulse(false), 600) }}
            onMouseEnter={() => setNewFolderHover(true)}
            onMouseLeave={() => setNewFolderHover(false)}
            className="w-10 h-8 flex items-center justify-center rounded-md border-none cursor-pointer p-0 shrink-0"
            style={{
              backgroundColor: newFolderHover ? 'var(--q-hover)' : 'transparent',
              color: newFolderPulse ? 'var(--q-accent-folder-open)' : newFolderHover ? 'var(--q-text)' : 'var(--q-text-secondary)',
              transform: newFolderHover ? 'scale(1.02)' : 'scale(1)',
              transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease, transform 120ms ease',
            }}
          >
            <FolderAdd size={20} />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {flatList.length === 0 ? (
          <div className="px-2 py-6 text-center text-text-tertiary text-14 font-interface">No chats</div>
        ) : (
          <>
            {flatList.map(({ item, depth }) => {
              const isActive = item.id === activeSessionId
              const isHovered = hoveredId === item.id
              const isFolder = item.type === 'folder'
              const isExpanded = isFolder && item.isExpanded
              const isDragging = dragItem?.id === item.id
              const isSelectedRemoval = multiSelect && selectedForRemoval.has(item.id)
              const zone = dropZone?.id === item.id ? dropZone.zone : null
              const folderColor = 'var(--q-accent-folder-open)'
              const iconColor = isFolder
                ? isExpanded ? folderColor : isActive ? 'var(--q-text)' : 'var(--q-text-tertiary)'
                : isSelectedRemoval ? 'var(--q-accent-danger)' : isActive ? 'var(--q-accent-info)' : isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)'
              const textColor = isFolder
                ? isExpanded ? folderColor : isActive ? 'var(--q-text)' : 'var(--q-text-secondary)'
                : isSelectedRemoval ? 'var(--q-accent-danger)' : isActive ? 'var(--q-accent-info)' : isHovered ? 'var(--q-text)' : 'var(--q-text-secondary)'
              const bgColor = isHovered && !isActive ? 'var(--q-hover)' : 'transparent'

              return (
                <div
                  key={item.id}
                  className="pl-2 pr-2 pb-1 relative"
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {zone === 'before' && (
                    <div
                      className="absolute -top-px h-0.5 bg-accent-primary rounded-sm pointer-events-none z-10"
                      style={{ left: `${8 + depth * 12}px`, right: '8px' }}
                    />
                  )}
                  {zone === 'after' && (
                    <div
                      className="absolute bottom-px h-0.5 bg-accent-primary rounded-sm pointer-events-none z-10"
                      style={{ left: `${8 + depth * 12}px`, right: '8px' }}
                    />
                  )}
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragItem({ id: item.id, kind: isFolder ? 'folder' : 'chat' })
                      e.dataTransfer.effectAllowed = 'move'
                      try {
                        const img = new Image()
                        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                        e.dataTransfer.setDragImage(img, 0, 0)
                      } catch {}
                    }}
                    onDragEnd={() => { setDragItem(null); setDropZone(null); setShowDropZone(false) }}
                    onDragOver={(e) => {
                      if (!dragItem || !canDrop(dragItem, item.id)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      const offset = e.clientY - rect.top
                      const z = getDropZone(offset, rect.height, isFolder)
                      if (dropZone?.id !== item.id || dropZone?.zone !== z) setDropZone({ id: item.id, zone: z })
                    }}
                    onDragLeave={(e) => {
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
                      const offset = e.clientY - rect.top
                      const z = getDropZone(offset, rect.height, isFolder)
                      handleDrop(item.id, z)
                    }}
                    onClick={() => {
                      if (multiSelect && !isFolder) {
                        const set = new Set(selectedForRemoval)
                        if (set.has(item.id)) set.delete(item.id)
                        else set.add(item.id)
                        setSelectedForRemoval(set)
                      } else {
                        isFolder ? onToggleFolder(item.id) : onSelectSession(item.id)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ x: e.clientX, y: e.clientY, item })
                    }}
                    className="rounded-md cursor-pointer flex items-center gap-2 box-border"
                    style={{
                      paddingLeft: `${depth * 12 + 10}px`,
                      paddingRight: '8px',
                      paddingTop: '6px',
                      paddingBottom: '6px',
                      minHeight: '36px',
                      backgroundColor: zone === 'into' ? 'var(--q-accent-folder-open-soft)' : bgColor,
                      border: zone === 'into' ? '2px solid var(--q-accent-folder-open-border)' : 'none',
                      boxShadow: 'none',
                      opacity: isDragging ? 0.15 : 1,
                      transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease',
                    }}
                  >
                    {isFolder
                      ? isExpanded
                        ? <FolderOpen size={20} className="shrink-0" style={{ color: iconColor, transform: isHovered ? 'translateX(2px)' : 'translateX(0)', transition: 'transform 120ms ease' }} />
                        : <Folder size={20} className="shrink-0" style={{ color: iconColor, transform: isHovered ? 'translateX(2px)' : 'translateX(0)', transition: 'transform 120ms ease' }} />
                      : <MessageSquare size={20} className="shrink-0" style={{ color: iconColor, transform: isHovered ? 'translateX(2px)' : 'translateX(0)', transition: 'transform 120ms ease' }} />
                    }
                    <span
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-interface"
                      style={{ color: textColor, lineHeight: '20px' }}
                    >
                      {item.title || 'Chat'}
                    </span>
                    {item.unread && !isActive && (
                      <span
                        className="bg-accent-primary text-bg text-12 font-semibold font-interface rounded-full px-2 min-w-[18px] text-center shrink-0 leading-none"
                        style={{ color: 'var(--q-bg)' }}
                      >
                        {item.messageCount || 0}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {/* Drop zone at end */}
            <div
              className="h-5 px-2"
              onDragOver={(e) => {
                if (dragItem) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setShowDropZone(true) }
              }}
              onDragLeave={() => setShowDropZone(false)}
              onDrop={(e) => { e.preventDefault(); handleDropToEnd() }}
            >
              {showDropZone && <div className="h-0.5 bg-accent-primary rounded-sm mx-2" />}
            </div>
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <SidebarContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          item={ctxMenu.item}
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

function SidebarContextMenu({ x, y, item, onClose, onRename, onOpenWindow, onDelete, multiSelect, selectedForRemoval, setMultiSelect, setSelectedForRemoval, onReorder, sessions }: any) {
  const isFolder = item.type === 'folder'
  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 200 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed bg-bg-panel rounded-md shadow-modal border border-border py-1 min-w-[180px] q-modal-enter"
        style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 250), zIndex: 210 }}
      >
        {multiSelect ? (
          <>
            <ContextMenuItem label="Deselect all" onClick={() => { setMultiSelect(false); setSelectedForRemoval(new Set()); onClose() }} />
            {selectedForRemoval.size > 0 && (
              <ContextMenuItem label={`Delete ${selectedForRemoval.size} chat${selectedForRemoval.size > 1 ? 'es' : ''}`} color="var(--q-accent-danger)" onClick={() => {
                onReorder?.(sessions.filter((s: Session) => !selectedForRemoval.has(s.id)))
                setMultiSelect(false)
                setSelectedForRemoval(new Set())
                onClose()
              }} />
            )}
          </>
        ) : (
          <>
            <ContextMenuItem label="Rename" onClick={() => { onRename(); onClose() }} />
            {!isFolder && <ContextMenuItem label="Select chat" onClick={() => { setMultiSelect(true); setSelectedForRemoval(new Set([item.id])); onClose() }} />}
            {!isFolder && <ContextMenuItem label="Open in separate window" onClick={() => { onOpenWindow(); onClose() }} />}
            {isFolder && <ContextMenuItem label="New subfolder" onClick={() => { onClose() }} />}
            <ContextMenuItem label={isFolder ? 'Delete folder' : 'Delete chat'} color="var(--q-accent-danger)" onClick={() => { onDelete(); onClose() }} />
            {isFolder && (
              <ContextMenuItem label="Delete folder with contents" color="var(--q-accent-danger)" onClick={() => {
                const ids = new Set([item.id])
                let found = true
                while (found) {
                  found = false
                  for (const s of sessions) {
                    if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); found = true }
                  }
                }
                onReorder?.(sessions.filter((s: Session) => !ids.has(s.id)))
                onClose()
              }} />
            )}
          </>
        )}
      </div>
    </>
  )
}

function ContextMenuItem({ label, color, onClick }: { label: string; color?: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center w-full px-3 py-2 border-none cursor-pointer text-14 font-interface text-left"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: color || 'var(--q-text)',
      }}
    >
      {label}
    </button>
  )
}