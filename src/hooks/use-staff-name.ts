'use client'

import { useCallback, useMemo } from 'react'
import { useFetch } from '@/hooks/use-fetch'

// §STAFF-NAME-RESOLUTION (shared): several CRM entities (Complaint.assignedTo,
// ComplaintEvent.actor, CustomerBehaviour.ratedBy, FollowUp assignment display…)
// may store EITHER a free-form staff name OR a User id (cuid). This hook
// resolves cuids to the user's display name so the UI never leaks raw ids
// like "cmv34si2y0001l6wgsi3zfrvj" to the merchant.
//
// §FALLBACK: unknown ids (deleted users, cross-system ids) and free-form
// names pass through unchanged — the raw value is still the best we have.
//
// §DATA-SOURCE: /api/users returns the business-scoped User list
// ({ items: [{ id, name, email, role }] }) — the same endpoint the
// follow-ups assignee filter uses. The fetch is deduped by TanStack Query,
// so multiple components sharing it cost one request.

export type StaffNameResolver = (raw: string | null | undefined) => string | null

export function useStaffNameResolver(): StaffNameResolver {
  const { data: usersData } = useFetch<{ items: Array<{ id: string; name: string | null }> } | Array<{ id: string; name: string | null }>>(
    '/api/users',
    []
  )

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    const items =
      usersData && typeof usersData === 'object' && 'items' in usersData
        ? (usersData as { items: Array<{ id: string; name: string | null }> }).items
        : Array.isArray(usersData)
          ? (usersData as Array<{ id: string; name: string | null }>)
          : []
    for (const u of items) {
      if (u?.id && u.name) map.set(u.id, u.name)
    }
    return map
  }, [usersData])

  const resolveName = useCallback<StaffNameResolver>(
    (raw) => {
      if (!raw) return null
      return nameById.get(raw) ?? raw
    },
    [nameById]
  )

  return resolveName
}

// §CURRENT-STAFF-PREFILL: for NEW entries (rating a customer, assigning a
// complaint…), prefill the staff-name field with the logged-in user's
// display name instead of forcing manual entry.
export function useCurrentStaffName(): string | null {
  const { data } = useFetch<{ user?: { name: string | null } }>('/api/auth/me', [])
  return data?.user?.name ?? null
}
