import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// /api/category-tree — CRUD for the nested category tree (PRD Part 35 §2).
// GET: return the full nested category tree for the current business.
//      Supports `?action=seed` to seed default categories if the tree is empty.
// POST: create a new category with `{ name, parentId? }`.
//
// §RBAC: POST requires OWNER/ADMIN. The category tree is a business-wide
// structural configuration that affects product organization, sourcing, and
// reports — STAFF must not be able to restructure it.

type CategoryNode = {
  id: string
  name: string
  level: number
  sortOrder: number
  children: CategoryNode[]
}

// Build a nested tree from a flat list of categories (single DB query, O(n) build).
function buildTree(
  rows: { id: string; name: string; level: number; sortOrder: number; parentId: string | null }[]
): CategoryNode[] {
  const byId = new Map<string, CategoryNode>()
  for (const r of rows) {
    byId.set(r.id, { id: r.id, name: r.name, level: r.level, sortOrder: r.sortOrder, children: [] })
  }
  const roots: CategoryNode[] = []
  for (const r of rows) {
    const node = byId.get(r.id)!
    if (r.parentId && byId.has(r.parentId)) {
      byId.get(r.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // Sort siblings by sortOrder then id for stable ordering.
  const sortSiblings = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    nodes.forEach((n) => sortSiblings(n.children))
  }
  sortSiblings(roots)
  return roots
}

// Seed default categories for the current business (only when the tree is empty).
async function seedDefaultCategories(businessId: string) {
  // Grocery (root)
  //   - Rice → Basmati, Miniket
  //   - Oil
  //   - Pulses
  // Electronics (root) → LED Bulbs, Fans
  // Construction (root) → Cement, Steel
  const grocery = await db.category.create({
    data: { businessId, name: 'Grocery', parentId: null, level: 0, sortOrder: 0 },
  })
  const electronics = await db.category.create({
    data: { businessId, name: 'Electronics', parentId: null, level: 0, sortOrder: 1 },
  })
  const construction = await db.category.create({
    data: { businessId, name: 'Construction', parentId: null, level: 0, sortOrder: 2 },
  })

  const rice = await db.category.create({
    data: { businessId, name: 'Rice', parentId: grocery.id, level: 1, sortOrder: 0 },
  })
  await db.category.createMany({
    data: [
      { businessId, name: 'Basmati', parentId: rice.id, level: 2, sortOrder: 0 },
      { businessId, name: 'Miniket', parentId: rice.id, level: 2, sortOrder: 1 },
    ],
  })
  await db.category.createMany({
    data: [
      { businessId, name: 'Oil', parentId: grocery.id, level: 1, sortOrder: 1 },
      { businessId, name: 'Pulses', parentId: grocery.id, level: 1, sortOrder: 2 },
    ],
  })

  await db.category.createMany({
    data: [
      { businessId, name: 'LED Bulbs', parentId: electronics.id, level: 1, sortOrder: 0 },
      { businessId, name: 'Fans', parentId: electronics.id, level: 1, sortOrder: 1 },
    ],
  })

  await db.category.createMany({
    data: [
      { businessId, name: 'Cement', parentId: construction.id, level: 1, sortOrder: 0 },
      { businessId, name: 'Steel', parentId: construction.id, level: 1, sortOrder: 1 },
    ],
  })
}

// GET /api/category-tree[?action=seed]
export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (action === 'seed') {
      // Seed only if the tree (scoped to current business) is empty.
      const count = await db.category.count({ where: { businessId: business.id } })
      if (count === 0) {
        await seedDefaultCategories(business.id)
      }
    }

    const rows = await db.category.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true, level: true, sortOrder: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json(buildTree(rows))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// POST /api/category-tree — create a category
export async function POST(req: NextRequest) {
  try {
    // §RBAC: Require OWNER or ADMIN.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    const name: string = (body.name ?? '').toString().trim()
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    const parentId: string | null = body.parentId ? String(body.parentId) : null

    let level = 0
    if (parentId) {
      // Verify parent exists in the current business and inherit its level.
      const parent = await db.category.findFirst({
        where: { id: parentId, businessId: business.id },
        select: { level: true },
      })
      if (!parent) {
        return NextResponse.json(
          { error: 'Parent category not found in your business' },
          { status: 404 }
        )
      }
      level = parent.level + 1
    }

    // Append to the end of its sibling group.
    const siblingCount = await db.category.count({
      where: parentId ? { parentId } : { businessId: business.id, parentId: null },
    })

    const created = await db.category.create({
      data: {
        businessId: business.id,
        name,
        parentId: parentId ?? null,
        level,
        sortOrder: siblingCount,
      },
    })
    return NextResponse.json(created)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
