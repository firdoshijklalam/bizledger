'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useTheme } from 'next-themes'
import { Search, Bell, Moon, Sun, Languages, BookOpen } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useMounted } from '@/hooks/use-mounted'
import { useNotifications } from '@/hooks/use-notifications'
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
  // §NOTIFICATION-FOUNDATION: Server-authoritative unread count from the API.
  // The badge is hidden when count = 0, shows the number when small, and
  // shows "99+" when large. This replaces the old hardcoded red dot.
  const { unreadTotal } = useNotifications()

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

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => setLanguage(language === 'en' ? 'bn' : language === 'bn' ? 'hi' : 'en')}
            aria-label="Toggle language"
          >
            <span className="text-xs font-bold">
              {language === 'en' ? 'বাং' : language === 'bn' ? 'हि' : 'EN'}
            </span>
          </Button>

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
