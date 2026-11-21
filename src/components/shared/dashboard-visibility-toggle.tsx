'use client'

/**
 * §DASHBOARD-VISIBILITY-TOGGLE: ONE reusable visibility toggle for ALL
 * Dashboard customization UI. Standardizes the show/hide control to match
 * the design first introduced in dashboard-card-management.tsx SortableCardItem.
 *
 * Design contract (do NOT deviate):
 *   - Pill-shaped track: w-9 h-5 rounded-full (36px × 20px)
 *   - Active (visible): bg-primary, thumb justified to end (right)
 *   - Inactive (hidden): bg-muted, thumb justified to start (left)
 *   - White thumb: w-4 h-4 rounded-full bg-white shadow-sm
 *   - Eye icon (w-2.5 h-2.5 text-primary) when visible
 *   - EyeOff icon (w-2.5 h-2.5 text-muted-foreground) when hidden
 *   - Accessible aria-label (caller supplies via ariaLabel prop)
 *   - 44px+ touch target via the outer button padding wrapper (caller's row)
 *
 * §SCOPE: Dashboard customization UI ONLY. Do NOT use this for generic app
 * settings — those should use the shadcn Switch component directly. This
 * component exists because the Dashboard customization UI has a specific
 * visual language (pill + eye icon) that differs from the generic switch.
 *
 * §PRESERVES: All state, persistence, ordering, default-tab behavior,
 * dirty-state behavior, Save/Cancel/Discard behavior. This is a
 * presentation-only component — the caller owns the `visible` state and
 * the `onChange` callback.
 */

import { Eye, EyeOff } from 'lucide-react'

export interface DashboardVisibilityToggleProps {
  /** Current visibility state. */
  visible: boolean
  /** Called when the toggle is clicked (toggles visibility). */
  onChange: () => void
  /** Accessible label. Should be context-specific, e.g. "Hide card", "Show section", "Hide Top Buyers". */
  ariaLabel: string
  /** Optional extra className for the outer button (e.g. for spacing). */
  className?: string
}

export function DashboardVisibilityToggle({
  visible,
  onChange,
  ariaLabel,
  className = '',
}: DashboardVisibilityToggleProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={ariaLabel}
      className={`w-9 h-5 rounded-full flex items-center transition-colors shrink-0 ${
        visible ? 'bg-primary justify-end' : 'bg-muted justify-start'
      } ${className}`}
    >
      <span className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5 flex items-center justify-center">
        {visible ? (
          <Eye className="w-2.5 h-2.5 text-primary" />
        ) : (
          <EyeOff className="w-2.5 h-2.5 text-muted-foreground" />
        )}
      </span>
    </button>
  )
}
