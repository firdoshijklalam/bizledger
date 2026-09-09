'use client'

import { useState, useCallback } from 'react'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle, Plus, Loader2, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { CHANNEL_META } from '@/lib/messaging'

// §PARTY-MESSAGES-SECTION: Compact conversations summary on the party detail page.
// Shows recent conversations + last message + unread count + "New" (in_app) button.

interface Conversation {
  id: string
  businessId: string
  partyId: string
  channel: string
  externalId: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadCount: number
  createdAt: string
  updatedAt: string
}

interface ConversationsResponse { items: Conversation[] }

export function PartyMessagesSection({ partyId, partyName }: { partyId: string; partyName?: string }) {
  const { data, loading, error, refetch } = useFetch<ConversationsResponse>(
    `/api/conversations?partyId=${partyId}`,
    [partyId]
  )
  const conversations = data?.items ?? []

  const { setActiveView } = useAppStore()

  const handleViewAll = () => {
    setActiveView('messages' as any)
  }

  const handleNewInApp = async () => {
    try {
      // Create an in_app conversation for this party
      await apiPost('/api/conversations', {
        partyId,
        channel: 'in_app',
      })
      toast.success('Conversation created')
      refetch()
    } catch (e: any) {
      toast.error(e.message || 'Failed to create conversation')
    }
  }

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0)

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageCircle className="w-4 h-4 text-emerald-500" />
          Messages
          {totalUnread > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              {totalUnread} unread
            </span>
          )}
          {conversations.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{conversations.length}</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {conversations.length > 0 && (
            <button
              onClick={handleViewAll}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 px-2 py-1 rounded-lg flex items-center gap-0.5 transition-colors"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={handleNewInApp}
            className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-emerald-200 dark:hover:bg-emerald-900/40 transition-colors"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load messages</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <MessageCircle className="w-6 h-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No conversations yet</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1">
          <AnimatePresence initial={false}>
            {conversations.slice(0, 5).map((c) => {
              const meta = CHANNEL_META[c.channel] || CHANNEL_META.in_app
              return (
                <motion.button
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={handleViewAll}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
                >
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${meta.color}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground truncate">
                      {c.lastMessagePreview || 'No messages yet'}
                    </p>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                      {c.unreadCount}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">
                    {timeAgo(c.lastMessageAt || c.updatedAt)}
                  </span>
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
