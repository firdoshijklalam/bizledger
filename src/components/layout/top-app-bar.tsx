'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useTheme } from 'next-themes'
import { Search, Bell, Moon, Sun, Languages, BookOpen, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMounted } from '@/hooks/use-mounted'
import { useNotificationStore } from '@/store/notification-store'
import { apiPut } from '@/hooks/use-fetch'
// §1: GlobalVoiceInput removed — replaced by draggable FloatingKeyboardMic

const VIEW_TITLES: Record<string, string> = {
  dashboard: 'dash.title',
  khata: 'khata.title',
  inventory: 'inv.title',
  billing: 'bill.title',
  reports: 'rep.title',
  'ai-tools': 'ai.tools',
  settings: 'set.title',
  notifications: 'header.notifications',
  'sale-pad': 'qa.quickSale',
  sourcing: 'B2B Sourcing',
  staff: 'Staff Management',
  history: 'History & Reports',
  'online-orders': 'Online Orders',
}

export function TopAppBar() {
  const { activeView, setActiveView, setShowSearch, business } = useAppStore()
  const { t, language, setLanguage } = useI18n()
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()
  // §SHARED-UNREAD: Read unreadTotal directly from the shared Zustand store.
  // This avoids a duplicate useFetch call in TopAppBar (items are only needed
  // in NotificationsView). The store is updated by useNotifications() which
  // is called from NotificationsView + the initial fetch on app mount.
  // TopAppBar re-renders immediately when unreadTotal changes in the store.
  const unreadTotal = useNotificationStore((s) => s.unreadTotal)

  const titleKey = VIEW_TITLES[activeView] || 'app.name'

  return (
    <header className="sticky top-0 z-30 h-14 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="flex items-center justify-between h-full px-3 sm:px-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-2 min-w-0"
            aria-label="Go to dashboard"
          >
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold leading-tight truncate">
                {business?.name || t('app.name')}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight truncate">
                {t(titleKey)}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          {/* §1: Static mic removed from header — replaced by draggable FloatingKeyboardMic
              that only appears when the keyboard/input is active. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => setShowSearch(true)}
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full relative"
            onClick={() => setActiveView('notifications')}
            aria-label={t('header.notifications')}
          >
            <Bell className="w-5 h-5" />
            {/* §NOTIFICATION-FOUNDATION: Dynamic badge bound to server-authoritative
                unreadTotal. Hidden when 0. Shows count when ≤9, "99+" when ≥10.
                Replaces the old hardcoded red dot that was always visible. */}
            {unreadTotal > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center ring-2 ring-background">
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </Button>

          {/* §LANGUAGE-PICKER: explicit 3-way picker (replaces the blind
              en→bn→hi cycle toggle). Users now SEE which languages exist and
              which is active — critical now that every core view is fully
              localized. Tapping the current language closes the popover. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label={t('lang.pick')}
              >
                <span className="text-xs font-bold text-primary">
                  {language === 'en' ? 'EN' : language === 'bn' ? 'বাং' : 'हि'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1.5">
              <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('lang.pick')}
              </p>
              {(['en', 'bn', 'hi'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang)
                    // §LANGUAGE-PERSIST-SYNC (Task 10 bug fix): app-shell
                    // hydrates the language FROM /api/app-settings on every
                    // load, so a picker choice that only sets the local store
                    // was silently reverted on the next reload. Fire-and-forget
                    // the same PUT the Settings picker does (partial body —
                    // the route upserts, undefined fields are left unchanged).
                    // Failure is non-fatal: local choice still applies this
                    // session; worst case it reverts after reload, exactly the
                    // pre-fix behavior.
                    apiPut('/api/app-settings', { language: lang }).catch(() => {})
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
                    language === lang
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'hover:bg-muted text-foreground'
                  }`}
                  aria-pressed={language === lang}
                >
                  <span>{t('lang.' + lang)}</span>
                  {language === lang && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
