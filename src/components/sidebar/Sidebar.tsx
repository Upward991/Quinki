import React, { useState, useRef, useCallback } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, useDroppable, useDraggable,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Folder, FolderOpen, MessageSquare, MessageSquarePlus, FolderAdd } from '../icons'

interface SidebarProps {
  sessions: any[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onToggleFolder: (id: string) => void
  onReorder: (sessions: any[]) => void
  welcomeMode: boolean
  onRenameSession?: (id: string, label: string) => void
  onRenameFolder?: (id: string, name: string) => void
  onCreateFolder?: (parentId?: string) => void
  onDeleteFolder?: (id: string, withContents: boolean) => void
  onMoveSession?: (id: string, folderId: string | null, order: number) => void
  onMoveFolder?: (id: string, parentId: string | null, order: number) => void
}

// === Drop zone computation (same as Flutter) ===
function computeZone(y: number, h: number, isFolder: boolean): 'before' | 'after' | 'into' {
  if (isFolder) {
    if (y < h * 0.15) return 'before'
    if (y > h * 0.85) return 'after'
    return 'into'
  }
  return y < h * 0.5 ? 'before' : 'after'
}

// === Anti-cycle check for folders ===
function isDescendant(sessions: any[], targetId: string, dragId: string): boolean {
  const children = sessions.filter(s => s.parentId === dragId)
  for (const c of children) {
    if (c.id === targetId) return true
    if (c.type === 'folder' && isDescendant(sessions, targetId, c.id)) return true
  }
  return false
}

function canAccept(sessions: any[], dragItem: any, targetId: string): boolean {
  if (!dragItem) return false
  if (dragItem.id === targetId) return false
  // Anti-cycle: can't drop a folder into itself or its descendants
  if (dragItem.kind === 'folder' && isDescendant(sessions, targetId, dragItem.id)) return false
  return true
}

export function Sidebar(props: SidebarProps) {
  const { sessions: e, activeSessionId: t, onSelectSession: n, onNewSession: r,
    onToggleFolder: i, onReorder: a, welcomeMode: o } = props

  const [hovered, setHovered] = useState<string | null>(null)
  const [newChatFlash, setNewChatFlash] = useState(false)
  const [folderFlash, setFolderFlash] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: any } | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bottomDropActive, setBottomDropActive] = useState(false)
  const [delConfirm, setDelConfirm] = useState<any>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [dropZone, setDropZone] = useState<{ id: string; zone: string } | null>(null)

  const dragRef = useRef<any>(null)
  const [activeDragItem, setActiveDragItem] = useState<any>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Build flat display list
  const flatList: { item: any; depth: number }[] = []
  const topItems = e.filter(s => !s.parentId).sort((a, b) => (b.order || 0) - (a.order || 0))
  function buildList(items: any[], depth: number) {
    for (const item of items.sort((a, b) => (b.order || 0) - (a.order || 0))) {
      flatList.push({ item, depth })
      if (item.type === 'folder' && expandedFolders.has(item.id)) {
        const children = e.filter(s => s.parentId === item.id)
        buildList(children, depth + 1)
      }
    }
  }
  buildList(topItems, 0)

  function handleDragStart(ev: any) {
    const item = flatList.find(f => f.item.id === ev.active.id)
    if (item) {
      dragRef.current = { id: ev.active.id, kind: item.item.type === 'folder' ? 'folder' : 'chat' }
      setActiveDragItem(item.item)
    }
  }

  function handleDragMove(ev: any) {
    const over = ev.over
    if (!over || !dragRef.current) { setDropZone(null); return }
    const targetItem = e.find(s => s.id === over.id)
    if (!targetItem || !canAccept(e, dragRef.current, over.id)) { setDropZone(null); return }
    // Use DOM getBoundingClientRect for precise zone computation
    const el = document.querySelector(`[data-row-id="${over.id}"]`)
    if (!el) { setDropZone(null); return }
    const rect = el.getBoundingClientRect()
    const pointerY = (ev.activatorEvent?.clientY || 0) + ev.delta.y
    const relY = pointerY - rect.top
    const isFolder = targetItem.type === 'folder'
    const effectiveIsFolder = isFolder && dragRef.current.kind !== 'folder'
    const zone = computeZone(relY, rect.height, effectiveIsFolder)
    if (dropZone?.id !== over.id || dropZone?.zone !== zone) {
      setDropZone({ id: over.id, zone })
    }
  }

  function handleDragEnd(ev: any) {
    const { active, over } = ev
    if (!over || !dragRef.current) { dragRef.current = null; setDropZone(null); return }
    const dragItem = e.find(s => s.id === active.id)
    const targetItem = e.find(s => s.id === over.id)
    if (!dragItem || !targetItem || !canAccept(e, dragRef.current, over.id)) {
      dragRef.current = null; setDropZone(null); return
    }
    const isFolder = targetItem.type === 'folder'
    const el = document.querySelector(`[data-row-id="${over.id}"]`)
    if (!el) { dragRef.current = null; setDropZone(null); setActiveDragItem(null); return }
    const rect = el.getBoundingClientRect()
    const pointerY = (ev.activatorEvent?.clientY || 0) + ev.delta.y
    const relY = pointerY - rect.top
    const effectiveIsFolder = isFolder && dragRef.current.kind !== 'folder'
    const zone = computeZone(relY, rect.height, effectiveIsFolder)
    
    if (zone === 'into' && isFolder) {
      if (dragItem.type === 'folder') { props.onMoveFolder?.(dragItem.id, over.id, Date.now()) }
      else { props.onMoveSession?.(dragItem.id, over.id, Date.now()) }
    } else if (zone === 'before') {
      const parentId = targetItem.parentId || null
      if (dragItem.type === 'folder') { props.onMoveFolder?.(dragItem.id, parentId, (targetItem.order || 0) + 1) }
      else { props.onMoveSession?.(dragItem.id, parentId, (targetItem.order || 0) + 1) }
    } else if (zone === 'after') {
      const parentId = targetItem.parentId || null
      if (dragItem.type === 'folder') { props.onMoveFolder?.(dragItem.id, parentId, (targetItem.order || 0) - 1) }
      else { props.onMoveSession?.(dragItem.id, parentId, (targetItem.order || 0) - 1) }
    }
    dragRef.current = null
    setDropZone(null)
    setActiveDragItem(null)
    // Force clear indicator after a frame
    requestAnimationFrame(() => setDropZone(null))
  }

  function handleRename(id: string, kind: string) {
    const v = renameVal.trim()
    if (v) {
      if (kind === 'folder') props.onRenameFolder?.(id, v)
      else props.onRenameSession?.(id, v)
    }
    setRenaming(null)
  }

  function doDelete(item: any) {
    if (item.type === 'folder') {
      props.onDeleteFolder?.(item.id, false)
    } else {
      a?.(e.filter(s => s.id !== item.id))
    }
    setDelConfirm(null)
    setContextMenu(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header buttons */}
      <div style={{ padding: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => { r(); setNewChatFlash(true); setTimeout(() => setNewChatFlash(false), 600) }}
            onMouseEnter={() => setHovered('newchat')}
            onMouseLeave={() => setHovered(null)}
            style={{
              flex: 1, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
              backgroundColor: o || hovered === 'newchat' ? 'var(--q-hover)' : 'transparent',
              color: o ? 'var(--q-accent-info)' : newChatFlash ? 'var(--q-accent-primary)' : hovered === 'newchat' ? 'var(--q-text)' : 'var(--q-text-secondary)',
              padding: 0,
            }}
          >
            <MessageSquarePlus size={20} />
          </button>
          <button
            onClick={() => { props.onCreateFolder?.(); setFolderFlash(true); setTimeout(() => setFolderFlash(false), 600) }}
            onMouseEnter={() => setHovered('folder')}
            onMouseLeave={() => setHovered(null)}
            style={{
              width: '40px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
              backgroundColor: hovered === 'folder' ? 'var(--q-hover)' : 'transparent',
              color: folderFlash ? 'var(--q-accent-folder-open)' : hovered === 'folder' ? 'var(--q-text)' : 'var(--q-text-secondary)',
              padding: 0, flexShrink: 0, transform: hovered === 'folder' ? 'scale(1.02)' : 'scale(1)',
            }}
          >
            <FolderAdd size={20} />
          </button>
        </div>
      </div>

      {/* Session list with DnD */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {flatList.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
            No chats
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { dragRef.current = null; setDropZone(null); setActiveDragItem(null) }}
          >
            {flatList.map(({ item, depth }) => (
              <SortableRow
                key={item.id}
                item={item}
                depth={depth}
                isActive={item.id === t}
                isHovered={hovered === item.id}
                isExpanded={expandedFolders.has(item.id)}
                renaming={renaming === item.id}
                renameVal={renameVal}
                dropZone={dropZone}
                onSelect={() => {
                  if (multiSelect && item.type !== 'folder') {
                    setSelected(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
                  } else if (item.type === 'folder') {
                    setExpandedFolders(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
                  } else {
                    n(item.id)
                  }
                }}
                onHover={(h: boolean) => setHovered(h ? item.id : null)}
                onContextMenu={(x: number, y: number) => setContextMenu({ x, y, item })}
                onRenameStart={() => { setRenaming(item.id); setRenameVal(item.title || '') }}
                onRenameChange={setRenameVal}
                onRenameCommit={() => handleRename(item.id, item.type)}
                onRenameCancel={() => setRenaming(null)}
              />
            ))}
            <DragOverlay dropAnimation={null}>
              {activeDragItem && (() => {
                const flat = flatList.find(f => f.item.id === activeDragItem.id)
                if (!flat) return null
                return (
                  <div style={{ width: 260, opacity: 0.95 }}>
                    <SortableRow
                      item={activeDragItem}
                      depth={flat.depth}
                      isActive={activeDragItem.id === t}
                      isHovered={false}
                      isExpanded={expandedFolders.has(activeDragItem.id)}
                      renaming={false}
                      renameVal={''}
                      dropZone={null}
                      onSelect={() => {}}
                      onHover={() => {}}
                      onContextMenu={() => {}}
                      onRenameStart={() => {}}
                      onRenameChange={() => {}}
                      onRenameCommit={() => {}}
                      onRenameCancel={() => {}}
                      isOverlay
                    />
                  </div>
                )
              })()}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          multiSelect={multiSelect}
          selectedCount={selected.size}
          onClose={() => setContextMenu(null)}
          onRename={() => { setRenaming(contextMenu.item.id); setRenameVal(contextMenu.item.title || ''); setContextMenu(null) }}
          onSelect={() => { setMultiSelect(true); setSelected(new Set([contextMenu.item.id])); setContextMenu(null) }}
          onOpenWindow={() => {}}
          onDelete={() => { setDelConfirm(contextMenu.item); setContextMenu(null) }}
          onDeleteFolder={(withContents: boolean) => { props.onDeleteFolder?.(contextMenu.item.id, withContents); setContextMenu(null) }}
          onDeselectAll={() => { setMultiSelect(false); setSelected(new Set()); setContextMenu(null) }}
          onDeleteSelected={() => { a?.(e.filter(s => !selected.has(s.id))); setMultiSelect(false); setSelected(new Set()); setContextMenu(null) }}
        />
      )}

      {/* Delete confirmation modal */}
      {delConfirm && (
        <ConfirmModal
          title={delConfirm.type === 'folder' ? `Delete ${delConfirm.title}?` : `Delete ${delConfirm.title}?`}
          subtitle={delConfirm.type === 'folder' ? 'Chats inside will be moved to the parent level.' : `${delConfirm.title} will be permanently deleted.`}
          onCancel={() => { setDelConfirm(null); setContextMenu(null) }}
          onConfirm={() => doDelete(delConfirm)}
        />
      )}
    </div>
  )
}

// === Sortable Row ===
function SortableRow({ item, depth, isActive, isHovered, isExpanded, renaming, renameVal, dropZone, onSelect, onHover, onContextMenu, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, isOverlay }: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: !!isOverlay })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.id, disabled: !!isOverlay })

  const isFolder = item.type === 'folder'
  const expanded = isExpanded
  const showDropIndicator = dropZone?.id === item.id

  const textColor = isFolder
    ? expanded ? 'var(--q-accent-folder-open)' : isHovered ? 'var(--q-text)' : 'var(--q-text-secondary)'
    : isActive ? 'var(--q-accent-info)' : isHovered ? 'var(--q-text)' : 'var(--q-text-secondary)'
  const iconColor = isFolder
    ? expanded ? 'var(--q-accent-folder-open)' : isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)'
    : isActive ? 'var(--q-accent-info)' : isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)'
  const bgColor = isHovered && !isActive ? 'var(--q-hover)' : 'transparent'

  return (
    <div
      ref={setDropRef}
      data-row-id={item.id}
      style={{ paddingLeft: '8px', paddingRight: '8px', paddingBottom: '4px', position: 'relative' }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Drop indicator: before */}
      {showDropIndicator && dropZone.zone === 'before' && (
        <div style={{ position: 'absolute', top: '0px', left: `${8 + depth * 12}px`, right: '8px', height: '2px', backgroundColor: 'var(--q-tab-accent)', borderRadius: '1px', zIndex: 10, pointerEvents: 'none' }} />
      )}
      {/* Drop indicator: after */}
      {showDropIndicator && dropZone.zone === 'after' && (
        <div style={{ position: 'absolute', bottom: '1px', left: `${8 + depth * 12}px`, right: '8px', height: '2px', backgroundColor: 'var(--q-tab-accent)', borderRadius: '1px', zIndex: 10, pointerEvents: 'none' }} />
      )}

      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={onSelect}
        onContextMenu={(e: any) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY) }}
        style={{
          paddingLeft: `${depth * 12 + 10}px`, paddingRight: '8px', paddingTop: '6px', paddingBottom: '6px',
          minHeight: '36px', borderRadius: 'var(--radius-md)',
          backgroundColor: showDropIndicator && dropZone.zone === 'into' ? 'var(--q-accent-folder-open-soft)' : bgColor,
          border: showDropIndicator && dropZone.zone === 'into' ? '2px solid var(--q-accent-folder-open-border)' : 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          opacity: isDragging && !isOverlay ? 0.15 : 1, boxSizing: 'border-box',
          boxShadow: isOverlay ? '0 8px 16px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {/* Icon */}
        {isFolder ? (
          <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, transform: 'translateZ(0)' }}>
            <FolderOpen size={20} style={{ color: 'var(--q-accent-folder-open)', position: 'absolute', left: 0, top: 0, transform: isHovered ? 'translateX(2px)' : 'translateX(0)', opacity: expanded ? 1 : 0, pointerEvents: 'none' }} />
            <Folder size={20} style={{ color: isHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)', transform: isHovered ? 'translateX(2px)' : 'translateX(0)', opacity: expanded ? 0 : 1 }} />
          </span>
        ) : (
          <MessageSquare size={20} style={{ color: iconColor, flexShrink: 0, transform: isHovered ? 'translateX(2px)' : 'translateX(0)' }} />
        )}

        {/* Title or rename input */}
        {renaming ? (
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => onRenameChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameCommit() }
              else if (e.key === 'Escape') { onRenameCancel() }
            }}
            onBlur={onRenameCommit}
            style={{
              color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)',
              flex: 1, background: 'transparent', border: 'none', borderRadius: 0, padding: 0, outline: 'none',
            }}
          />
        ) : (
          <span style={{ color: textColor, fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '20px' }}>
            {item.title || 'Chat'}
          </span>
        )}

        {/* Unread badge */}
        {item.unread && !isActive && (
          <span style={{ backgroundColor: 'var(--q-accent-primary)', color: 'var(--q-bg)', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-interface)', borderRadius: '999px', padding: '4px 8px', minWidth: '18px', textAlign: 'center', flexShrink: 0, lineHeight: '1' }}>
            {item.messageCount || 0}
          </span>
        )}
      </div>
    </div>
  )
}

// === Context Menu ===
function ContextMenu({ x, y, item, multiSelect, selectedCount, onClose, onRename, onSelect, onOpenWindow, onDelete, onNewSubfolder, onDeleteFolder, onDeselectAll, onDeleteSelected }: any) {
  const isFolder = item.type === 'folder'
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div style={{
        position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 250),
        zIndex: 210, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: '180px',
      }}>
        {multiSelect ? (
          <>
            <MenuItem label="Deselect all" onClick={onDeselectAll} />
            {selectedCount > 0 && <MenuItem label={`Delete ${selectedCount} chat${selectedCount > 1 ? 'es' : ''}`} color="var(--q-accent-danger)" onClick={onDeleteSelected} />}
          </>
        ) : (
          <>
            <MenuItem label="Rename" onClick={onRename} />
            {!isFolder && <MenuItem label="Select chat" onClick={onSelect} />}
            {!isFolder && <MenuItem label="Open in separate window" onClick={onOpenWindow} />}
            {isFolder && <MenuItem label="New subfolder" onClick={onNewSubfolder} />}
            <MenuItem label={isFolder ? 'Delete folder' : 'Delete chat'} color="var(--q-accent-danger)" onClick={onDelete} />
            {isFolder && <MenuItem label="Delete folder with contents" color="var(--q-accent-danger)" onClick={() => onDeleteFolder(true)} />}
          </>
        )}
      </div>
    </>
  )
}

function MenuItem({ label, color, onClick }: any) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', color: color || 'var(--q-text)',
        fontSize: '14px', fontFamily: 'var(--font-interface)', textAlign: 'left',
      }}
    >
      {label}
    </button>
  )
}

// === Confirmation Modal ===
function ConfirmModal({ title, subtitle, onCancel, onConfirm }: any) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onCancel} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 310,
        backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)',
        border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '320px', maxWidth: '400px',
      }}>
        <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>{title}</div>
        <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>{subtitle}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 400, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600, cursor: 'pointer' }}
          >
            Delete
          </button>
        </div>
      </div>
    </>
  )
}