import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// /api/category-tree/[id] — update or delete a category node (PRD Part 35 §2).
// PATCH: update name / parentId / sortOrder. Recalculates level on parent change
//        and cascades new levels to all descendants.
// DELETE: delete a category AND all its descendants (cascade — handled by Prisma onDelete: Cascade).

// Recursively recompute descendant levels after a parent change.
// Walks the subtree using parentId edges and updates each node's level.
async function cascadeDescendantLevels(rootId: string, rootLevel: number, businessId: string) {
  const stack: { id: string; level: number }[] = [{ id: rootId, level: rootLevel }]
  while (stack.length > 0) {
    const current = stack.pop()!
    await db.category.updateMany({ where: { id: current.id, businessId }, data: { level: current.level } })
    const children = await db.category.findMany({
      where: { parentId: current.id },
      select: { id: true },
    })
    for (const c of children) {
      stack.push({ id: c.id, level: current.level + 1 })
    }
  }
}

// Collect all descendant IDs of a node (excluding the node itself).
// Used to detect cycles before re-parenting.
async function collectDescendantIds(rootId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = await db.category.findMany({
      where: { parentId: current },
      select: { id: true },
    })
    for (const c of children) {
      if (!ids.has(c.id)) {
        ids.add(c.id)
        stack.push(c.id)
      }
    }
  }
  return ids
}

// PATCH /api/category-tree/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    // Verify ownership.
    const existing = await db.category.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Category not found in your business' }, { status: 404 })
    }

    const body = await req.json()
    const data: {
      name?: string
      parentId?: string | null
      sortOrder?: number
      level?: number
    } = {}

    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }

    const hasParentUpdate = Object.prototype.hasOwnProperty.call(body, 'parentId')
    if (hasParentUpdate) {
      const newParentId: string | null = body.parentId ? String(body.parentId) : null

      // Prevent making a node its own parent (would create a self-loop).
      if (newParentId === id) {
        return NextResponse.json({ error: 'A category cannot be its own parent' }, { status: 400 })
      }

      if (newParentId) {
        // Verify new parent exists in the same business.
        const parent = await db.category.findFirst({
          where: { id: newParentId, businessId: business.id },
          select: { id: true, level: true },
        })
        if (!parent) {
          return NextResponse.json(
            { error: 'New parent category not found in your business' },
            { status: 404 }
          )
        }
        // Prevent making a node a descendant of itself (would create a cycle).
        const descendantIds = await collectDescendantIds(id)
        if (descendantIds.has(newParentId)) {
          return NextResponse.json(
            { error: 'Cannot move a category under one of its own descendants' },
            { status: 400 }
          )
        }
        data.parentId = newParentId
        data.level = parent.level + 1
      } else {
        // Moving to root.
        data.parentId = null
        data.level = 0
      }
    }

    if (typeof body.sortOrder === 'number' && !Number.isNaN(body.sortOrder)) {
      data.sortOrder = body.sortOrder
    }

    const updated = await db.category.updateMany({ where: { id, businessId: business.id }, data })

    // If the level changed, cascade the new level to all descendants.
    if (
      hasParentUpdate &&
      typeof data.level === 'number' &&
      data.level !== existing.level
    ) {
      await cascadeDescendantLevels(id, data.level, business.id)
    }

    return NextResponse.json({ ...updated, id })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// DELETE /api/category-tree/[id] — cascade delete via Prisma (onDelete: Cascade on parent relation).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    const existing = await db.category.findFirst({
      where: { id, businessId: business.id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Category not found in your business' }, { status: 404 })
    }

    // Deleting the parent cascades to all children automatically (schema: onDelete: Cascade).
    await db.category.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
