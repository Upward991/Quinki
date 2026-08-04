import React, { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ProviderDnDListProps {
  items: any[]
  onReorder: (newOrder: any[]) => void
  renderItem: (item: any, idx: number) => React.ReactNode
}

export function ProviderDnDList(props: ProviderDnDListProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const items = props.items || []
  const sortableItems = items.map((item, idx) => ({ id: item.id || `prov-${idx}`, item, idx }))

  function handleDragStart(e: any) {
    setActiveId(e.active.id)
  }

  function handleDragEnd(e: any) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = sortableItems.findIndex(s => s.id === active.id)
    const newIdx = sortableItems.findIndex(s => s.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const newOrder = arrayMove(items, oldIdx, newIdx)
    props.onReorder(newOrder)
  }

  const activeItem = activeId ? sortableItems.find(s => s.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableItems.map(s => s.id)} strategy={verticalListSortingStrategy}>
        {sortableItems.map(({ id, item, idx }) => (
          <SortableProviderRow key={id} id={id} item={item} idx={idx} renderItem={props.renderItem} />
        ))}
      </SortableContext>
      <DragOverlay>
        {activeItem ? (
          <div style={{ opacity: 0.9, boxShadow: 'var(--shadow-floating)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {props.renderItem(activeItem.item, activeItem.idx)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function SortableProviderRow({ id, item, idx, renderItem }: {
  id: string
  item: any
  idx: number
  renderItem: (item: any, idx: number) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'none',
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {renderItem(item, idx)}
    </div>
  )
}