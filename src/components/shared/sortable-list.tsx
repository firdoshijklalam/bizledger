'use client'

/**
 * §STEP-4C-FIX: Reusable drag-and-drop sortable list built on @dnd-kit.
 *
 * §FIX: The SortableList now accepts a `sortableItems` prop that specifies
 * which item IDs are actually draggable/droppable. Only these IDs are placed
 * in the SortableContext. Hidden/disabled items are rendered but cannot be
 * drag targets. The `onReorder` callback receives the new order of ONLY the
 * sortable (visible) items. The caller is responsible for reconstructing the
 * full order (preserving hidden items) using `reconstructOrderFromDrag`.
 *
 * §DESIGN:
 *   - Uses PointerSensor with a 5px distance activation constraint so taps
 *     on buttons/switches inside items don't accidentally trigger drags.
 *   - Uses KeyboardSensor for accessibility (arrow keys to reorder).
 *   - Each item receives a GripVertical drag handle via render props.
 *   - The caller's onReorder callback receives the new ordered ID array
 *     of ONLY the sortable items.
 */

import React from 'react'
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

// ─── Pure helper: reconstruct full order from DnD visible reorder ──────

/**
 * §STEP-4C-FIX: Reconstruct the full order array after a DnD reorder of
 * visible items. Hidden items retain their relative positions.
 *
 * @param fullOrder - The original full order array (visible + hidden IDs)
 * @param visibleIds - Which IDs are visible/sortable
 * @param newVisibleOrder - The new order of visible IDs after DnD
 * @returns The reconstructed full order with hidden items preserved
 *
 * §ALGORITHM:
 *   Walk the original full order. For each position:
 *   - If the original item was visible, replace it with the next item from
 *     newVisibleOrder (consuming them in sequence).
 *   - If the original item was hidden, keep it in place.
 *   This preserves hidden items' relative positions while visible items
 *   adopt the new DnD order.
 *
 *   If any visible IDs in newVisibleOrder are missing from fullOrder, they
 *   are appended at the end (defensive).
 */
export function reconstructOrderFromDrag(
  fullOrder: string[],
  visibleIds: string[],
  newVisibleOrder: string[],
): string[] {
  const visibleSet = new Set(visibleIds)
  const newOrder: string[] = []
  let visibleIdx = 0

  // Walk the original full order
  for (const id of fullOrder) {
    if (visibleSet.has(id)) {
      // This position was occupied by a visible item → replace with next newVisibleOrder item
      if (visibleIdx < newVisibleOrder.length) {
        newOrder.push(newVisibleOrder[visibleIdx])
        visibleIdx++
      }
      // If newVisibleOrder is shorter (shouldn't happen), skip this position
    } else {
      // Hidden item → keep in place
      newOrder.push(id)
    }
  }

  // Append any visible IDs from newVisibleOrder that weren't consumed
  // (defensive — handles edge cases where fullOrder was missing visible IDs)
  while (visibleIdx < newVisibleOrder.length) {
    const id = newVisibleOrder[visibleIdx]
    if (!newOrder.includes(id)) {
      newOrder.push(id)
    }
    visibleIdx++
  }

  return newOrder
}

// ─── SortableList (container) ───────────────────────────────────────────

interface SortableListProps {
  /** IDs of items that are sortable (draggable + droppable). Only these go into SortableContext. */
  sortableItems: string[]
  /** Callback with the new order of ONLY the sortable items after DnD. */
  onReorder: (newSortableOrder: string[]) => void
  children: React.ReactNode
}

export function SortableList({ sortableItems, onReorder, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sortableItems.indexOf(active.id as string)
    const newIndex = sortableItems.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return
    const newOrder = [...sortableItems]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onReorder(newOrder)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

// ─── SortableListItem ────────────────────────────────────────────────────

interface SortableListItemProps {
  id: string
  /** If false, the item is rendered but NOT sortable (no drag handle, not a drop target). */
  sortable?: boolean
  children: (props: { dragHandleProps: React.HTMLAttributes<HTMLButtonElement> | null }) => React.ReactNode
}

export function SortableListItem({ id, sortable = true, children }: SortableListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !sortable })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const dragHandleProps: React.HTMLAttributes<HTMLButtonElement> | null = sortable
    ? { ...attributes, ...listeners }
    : null

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
