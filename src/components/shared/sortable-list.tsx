'use client'

/**
 * §STEP-4C: Reusable drag-and-drop sortable list built on @dnd-kit.
 *
 * Extracted from the DashboardCardManagementSheet pattern to provide
 * consistent drag-and-drop reordering across all dashboard customization sheets.
 *
 * §DESIGN:
 *   - Uses PointerSensor with a 5px distance activation constraint so taps
 *     on buttons/switches inside items don't accidentally trigger drags.
 *   - Uses KeyboardSensor for accessibility (arrow keys to reorder).
 *   - Each item receives a GripVertical drag handle via render props.
 *   - The caller's onReorder callback receives the new ordered ID array.
 *
 * §USAGE:
 *   <SortableList items={orderedIds} onReorder={handleReorder}>
 *     {orderedIds.map(id => (
 *       <SortableList.Item key={id} id={id}>
 *         {({ dragHandleProps }) => (
 *           <div className="flex items-center gap-2">
 *             <SortableList.DragHandle {...dragHandleProps} />
 *             <span>{labels[id]}</span>
 *           </div>
 *         )}
 *       </SortableList.Item>
 *     ))}
 *   </SortableList>
 */

import React, { createContext, useContext } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

// ─── SortableList (container) ───────────────────────────────────────────

interface SortableListProps {
  items: string[]
  onReorder: (newOrder: string[]) => void
  children: React.ReactNode
}

export function SortableList({ items, onReorder, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.indexOf(active.id as string)
    const newIndex = items.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return
    const newOrder = [...items]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onReorder(newOrder)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

// ─── SortableListItem ────────────────────────────────────────────────────

interface SortableListItemProps {
  id: string
  children: (props: { dragHandleProps: React.HTMLAttributes<HTMLButtonElement> }) => React.ReactNode
}

export function SortableListItem({ id, children }: SortableListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const dragHandleProps: React.HTMLAttributes<HTMLButtonElement> = {
    ...attributes,
    ...listeners,
  }

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandleProps })}
    </div>
  )
}

// ─── DragHandle (visual component) ───────────────────────────────────────

export function DragHandle({ ...props }: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`touch-none cursor-grab active:cursor-grabbing text-muted-foreground shrink-0 p-1 ${props.className || ''}`}
      aria-label="Drag to reorder"
    >
      <GripVertical className="w-4 h-4" />
    </button>
  )
}
