import { create } from 'zustand'
import type { Language } from '@/store/i18n-store'

/**
 * §MESSAGE-TEMPLATE-OVERRIDES
 *
 * Holds the per-business custom message templates loaded from
 * AppSettings.messageTemplates (JSON). Hydrated by app-shell from the
 * shared TanStack Query cache of /api/app-settings (zero extra requests)
 * and updated by the Settings → Templates editor after a successful PUT.
 *
 * message-templates.ts reads this store when generating any customer-facing
 * message — overrides win over built-in defaults, per slot + language.
 */

export type TemplateSlotId =
  | 'paymentReceivable'
  | 'paymentPayable'
  | 'overdue'
  | 'feedback'

/** slot → language → raw template text (placeholders NOT yet substituted) */
export type TemplateOverrides = Partial<
  Record<TemplateSlotId, Partial<Record<Language, string>>>
>

interface MessageTemplateState {
  overrides: TemplateOverrides
  /** Replace all overrides (hydrated from server or after save). */
  setOverrides: (overrides: TemplateOverrides) => void
  /**
   * Hydrate from a raw /api/app-settings row. Tolerates null / malformed
   * JSON (defensive — the server validates on write, but stale rows or a
   * partially-updated cache must never break message generation).
   */
  applyFromSettings: (settings: { messageTemplates?: string | null } | null | undefined) => void
}

export const useMessageTemplateStore = create<MessageTemplateState>()((set) => ({
  overrides: {},

  setOverrides: (overrides) => set({ overrides }),

  applyFromSettings: (settings) => {
    if (!settings?.messageTemplates) {
      set({ overrides: {} })
      return
    }
    try {
      const parsed = JSON.parse(settings.messageTemplates)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        set({ overrides: parsed as TemplateOverrides })
      } else {
        set({ overrides: {} })
      }
    } catch {
      // Malformed JSON in the DB — fall back to built-in defaults silently.
      set({ overrides: {} })
    }
  },
}))

/** Read the raw override for a slot+language without a React hook (works in
 *  plain modules like message-templates.ts). */
export function getRawOverride(slot: TemplateSlotId, lang: Language): string | null {
  const text = useMessageTemplateStore.getState().overrides?.[slot]?.[lang]
  return typeof text === 'string' && text.trim() ? text : null
}
