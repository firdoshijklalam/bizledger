'use client'

// §MESSAGES-VIEW: Internal inbox + thread for the unified messaging system.
//
// §LAYOUT: Mobile-first two-panel navigation pattern.
//   - Default: conversation list (newest first by lastMessageAt)
//   - On row tap: slides to thread view; back button returns to list.
//   - No tabs — simple conditional render driven by `selectedConversationId`.
//
// §API:
//   - GET /api/conversations → { items: Conversation[] }
//   - GET /api/conversations/[id] → { conversation: { ..., messages: Message[] } }
//   - POST /api/messages → { message } (in_app reply, direction='outbound', senderType='staff')
//   - POST /api/messages/[id]/read → { ok } (mark inbound as read)
//   - POST /api/messages/[id]/create-complaint → { complaint } (Create Complaint action)
//
// §CHANNEL-BADGES: CHANNEL_META provides label/icon/color per channel. Icons are
// stored as strings; resolved via ICON_MAP to actual lucide-react components.
//
// §EXTERNAL-CHANNELS: For non-in_app channels, replies are blocked. A banner
// informs the staff that external integration is not yet available. The thread
// is still readable (inbound customer messages visible), but no reply input.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ArrowLeft, Loader2, AlertTriangle, MessageSquare, Send, Mail, Smartphone,
  Instagram, MessageCircle, Plus, FileWarning, Check, CheckCheck, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { CHANNEL_META } from '@/lib/messaging'

// §TYPES: Mirror the Prisma Conversation + Message models. Kept in this file
// because the task spec lists them inline; we don't want to introduce a new
// shared type module just for one view.
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
  party?: { id: string; name: string; phone: string | null } | null
}

interface Message {
  id: string
  conversationId: string
  partyId: string
  channel: string
  direction: string
  senderType: string
  senderId: string | null
  body: string | null
  attachments: string | null
  externalMessageId: string | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

interface ConversationDetail extends Conversation {
  messages?: Message[]
}

// §ICON-MAP: Resolves the string icon name in CHANNEL_META to an actual
// lucide-react component. New channels must add their icon here.
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageCircle,
  Send,
  Mail,
  Smartphone,
  Instagram,
  MessageSquare,
}

// §CHANNEL-ICON: A dedicated component (NOT a function returning a component)
// so ESLint's `react-hooks/static-components` rule doesn't flag it as
// "creating a component during render". The icon resolution happens inside
// JSX via a normal map lookup.
function ChannelIcon({
  channel,
  className,
}: {
  channel: string
  className?: string
}) {
  const meta = CHANNEL_META[channel]
  const Resolved = (meta && ICON_MAP[meta.icon]) || MessageSquare
  return <Resolved className={className} />
}

// §HELPERS: Defensive extraction of `items` from the conversations list response.
// useFetch only auto-extracts `items` when `total`/`hasMore` is also present; the
// /api/conversations route returns just `{ items: [...] }`, so we unwrap manually.
function extractConversations(data: any): Conversation[] {
  if (!data) return []
  if (Array.isArray(data)) return data as Conversation[]
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
    return data.items as Conversation[]
  }
  return []
}

export function MessagesView() {
  // §LIST-STATE: Drives the two-panel layout. null = show conversation list;
  // any string = open that conversation's thread view.
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <AnimatePresence mode="wait" initial={false}>
        {selectedConversationId ? (
          <motion.div
            key="thread"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <MessageThreadView
              conversationId={selectedConversationId}
              onBack={() => setSelectedConversationId(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <ConversationListView onOpen={setSelectedConversationId} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §CONVERSATION-LIST-VIEW: The default inbox view — list of conversations
// sorted newest-first by lastMessageAt.
// ─────────────────────────────────────────────────────────────────────────────

function ConversationListView({ onOpen }: { onOpen: (id: string) => void }) {
  // §FETCH: useFetch caches the result at app-root, so returning to the list
  // after closing a thread shows stale data instantly while revalidating.
  const { data, loading, error, refetch } = useFetch<{ items: Conversation[] } | Conversation[]>(
    '/api/conversations',
    [],
  )

  const conversations = useMemo(() => extractConversations(data), [data])

  // §SORT: Newest first by lastMessageAt. Conversations with null lastMessageAt
  // (no messages yet) fall back to createdAt so they appear at the top.
  const sorted = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const ta = new Date(a.lastMessageAt ?? a.updatedAt ?? a.createdAt).getTime() || 0
      const tb = new Date(b.lastMessageAt ?? b.updatedAt ?? b.createdAt).getTime() || 0
      return tb - ta
    })
  }, [conversations])

  const totalUnread = useMemo(
    () => sorted.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0),
    [sorted],
  )

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* §HEADER */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-primary shrink-0" aria-hidden />
            Messages
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">
            {sorted.length} {sorted.length === 1 ? 'conversation' : 'conversations'}
            {totalUnread > 0 && ` · ${totalUnread} unread`}
          </p>
        </div>
        {totalUnread > 0 && (
          <span className="text-[11px] font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full shrink-0">
            {totalUnread} new
          </span>
        )}
      </div>

      {/* §LOADING */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="ml-2 text-sm text-muted-foreground">Loading messages…</span>
        </div>
      )}

      {/* §ERROR */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium mb-1">Failed to load messages</p>
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{error}</p>
          <button
            onClick={() => refetch()}
            className="text-sm text-primary font-medium inline-flex items-center gap-1"
          >
            <Loader2 className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      )}

      {/* §LIST + §EMPTY */}
      {!loading && !error && (
        <>
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                When customers send in-app messages, their conversations will appear here.
                External channels (WhatsApp, Telegram, etc.) will light up once their integrations ship.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {sorted.map((c, i) => (
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    onOpen={onOpen}
                    index={i}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ConversationRow({
  conversation,
  onOpen,
  index,
}: {
  conversation: Conversation
  onOpen: (id: string) => void
  index: number
}) {
  const meta = CHANNEL_META[conversation.channel]
  const unread = Number(conversation.unreadCount) || 0
  const customerName = conversation.party?.name
    || (conversation.partyId ? 'Unknown customer' : 'Anonymous')

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ delay: Math.min(index * 0.025, 0.25) }}
      layout
      onClick={() => onOpen(conversation.id)}
      aria-label={`Open conversation with ${customerName}`}
      className={`w-full text-left max-w-2xl mx-auto p-4 rounded-2xl border shadow-sm transition-all hover:shadow-md hover:border-primary/30 active:scale-[0.99] ${
        unread > 0
          ? 'bg-card border-primary/40'
          : 'bg-card border-border'
      }`}
    >
      {/* §ROW-1: avatar circle with channel icon + customer name + time */}
      <div className="flex items-center gap-3">
        <span
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            meta ? meta.color : 'bg-muted text-muted-foreground'
          }`}
          aria-hidden
        >
          <ChannelIcon channel={conversation.channel} className="w-5 h-5" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold truncate">{customerName}</p>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {timeAgo(conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt)}
            </span>
          </div>

          {/* §ROW-2: last message preview + unread badge */}
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={`text-xs truncate ${unread > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {conversation.lastMessagePreview || 'No messages yet'}
            </p>
            {unread > 0 && (
              <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>

          {/* §ROW-3: channel badge + external-id hint */}
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                meta ? meta.color : 'bg-muted text-muted-foreground'
              }`}
            >
              {meta ? meta.label : conversation.channel}
            </span>
            {conversation.party?.phone && (
              <span className="text-[10px] text-muted-foreground truncate">
                {conversation.party.phone}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §THREAD-VIEW: Single conversation with chronological messages.
// ─────────────────────────────────────────────────────────────────────────────

function MessageThreadView({
  conversationId,
  onBack,
}: {
  conversationId: string
  onBack: () => void
}) {
  const { data, loading, error, refetch, setData } = useFetch<{ conversation: ConversationDetail }>(
    `/api/conversations/${conversationId}`,
    [conversationId],
  )

  const conversation = data?.conversation ?? null
  const messages = useMemo<Message[]>(
    () => (conversation?.messages ?? []).slice().sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    [conversation?.messages],
  )

  // §SCROLL-TO-BOTTOM: When messages change, jump to the most recent message.
  // The ref + useEffect pattern is more reliable than auto-scroll hooks when
  // the thread is rendered inside a flex column with overflow-y-auto.
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, conversationId])

  // §MARK-READ: On open (and whenever messages change), mark any unread
  // inbound customer messages as read. Fires once per message id, with the
  // result merged back into the cached conversation so the unread pill clears.
  const markedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!conversation || !messages.length) return
    // §BATCH: Find unread inbound messages we haven't already marked.
    const toMark = messages.filter(
      (m) => m.direction === 'inbound' && !m.isRead && !markedRef.current.has(m.id),
    )
    if (toMark.length === 0) return

    // §LOCAL-FIRST: Optimistically flip the flags so the UI updates instantly.
    setData({
      conversation: {
        ...conversation,
        messages: messages.map((m) =>
          toMark.some((tm) => tm.id === m.id)
            ? { ...m, isRead: true, readAt: new Date().toISOString() }
            : m,
        ),
        unreadCount: 0,
      },
    })

    // §SERVER: Fire-and-forget POSTs. Failures are non-fatal (next visit re-marks).
    toMark.forEach((m) => {
      markedRef.current.add(m.id)
      apiPost(`/api/messages/${m.id}/read`, {}).catch((e) => {
        // Roll back the marker so a retry is possible next time.
        markedRef.current.delete(m.id)
        console.warn(`[messages] failed to mark ${m.id} as read:`, e)
      })
    })
  }, [messages, conversation, setData])

  const channel = conversation?.channel
  const isExternal = channel && channel !== 'in_app'
  const is_in_app = channel === 'in_app'
  const customerName = conversation?.party?.name
    || (conversation?.partyId ? 'Unknown customer' : 'Anonymous')

  return (
    <div className="max-w-2xl mx-auto flex flex-col" style={{ minHeight: 'calc(100vh - 12rem)' }}>
      {/* §THREAD-HEADER: Back button + customer name + channel badge */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-card border border-border shadow-sm hover:bg-muted transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate">{customerName}</h2>
          <ThreadHeaderMeta conversation={conversation} loading={loading} />
        </div>
      </div>

      {/* §EXTERNAL-BANNER: For non-in_app channels, replies are blocked. */}
      {conversation && isExternal && (
        <ExternalChannelBanner channel={channel} />
      )}

      {/* §THREAD-BODY: Scrollable message list */}
      <div className="flex-1 overflow-y-auto rounded-2xl bg-card border border-border p-3 space-y-2 max-h-[calc(100vh-22rem)] min-h-[200px]">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="ml-2 text-xs text-muted-foreground">Loading thread…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm font-medium mb-1">Failed to load thread</p>
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{error}</p>
            <button
              onClick={() => refetch()}
              className="text-xs text-primary font-medium inline-flex items-center gap-1"
            >
              <Loader2 className="w-3 h-3" /> Try again
            </button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              {is_in_app
                ? 'Send the first reply below to start this conversation.'
                : 'Inbound messages from this channel will appear here.'}
            </p>
          </div>
        )}

        {!loading && !error && messages.length > 0 && (
          <>
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                showCreateComplaint={is_in_app}
                onComplaintCreated={(complaintNumber) => {
                  // §AFTER-COMPLAINT: Refetch so the conversation reflects any
                  // server-side state changes (readAt etc.). Toast + nav hint.
                  refetch()
                  toast.success(`Complaint ${complaintNumber} created`, {
                    description: 'Open the Complaints tab to manage it.',
                  })
                }}
              />
            ))}
            <div ref={bottomRef} aria-hidden />
          </>
        )}
      </div>

      {/* §REPLY-INPUT: Only for in_app conversations. */}
      {conversation && is_in_app && (
        <ReplyInput
          conversationId={conversation.id}
          onSent={(msg) => {
            // §OPTIMISTIC-APPEND: Append the new message to the cached
            // conversation so the user sees it instantly while the API round-trip
            // completes. apiPost already returned the server-persisted message.
            setData({
              conversation: {
                ...conversation,
                messages: [...(conversation.messages ?? []), msg],
                lastMessageAt: msg.createdAt,
                lastMessagePreview: (msg.body ?? '').slice(0, 100),
              },
            })
            // §SCROLL: Force scroll-to-bottom on next tick (after React commit).
            requestAnimationFrame(() => {
              bottomRef.current?.scrollIntoView({ block: 'end' })
            })
          }}
        />
      )}
    </div>
  )
}

function ThreadHeaderMeta({
  conversation,
  loading,
}: {
  conversation: ConversationDetail | null
  loading: boolean
}) {
  if (loading || !conversation) {
    return <p className="text-[11px] text-muted-foreground truncate">Loading…</p>
  }
  const meta = CHANNEL_META[conversation.channel]
  const lastTime = timeAgo(conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt)
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
          meta ? meta.color : 'bg-muted text-muted-foreground'
        }`}
      >
        <ChannelIcon channel={conversation.channel} className="w-2.5 h-2.5" />
        {meta ? meta.label : conversation.channel}
      </span>
      {conversation.party?.phone && (
        <span className="truncate">{conversation.party.phone}</span>
      )}
      <span className="text-muted-foreground/60">·</span>
      <span>{lastTime}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §MESSAGE-BUBBLE: Renders a single message in the thread based on direction.
//   - inbound     → left-aligned (customer side)
//   - outbound    → right-aligned (staff side)
//   - internal_note → centered, muted, staff-only
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  showCreateComplaint,
  onComplaintCreated,
}: {
  message: Message
  showCreateComplaint: boolean
  onComplaintCreated: (complaintNumber: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const direction = message.direction

  // §INTERNAL-NOTE: Centered pill, muted, no bubble styling.
  if (direction === 'internal_note') {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="max-w-[85%] px-3 py-2 rounded-xl bg-muted/60 border border-dashed border-border text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">
            Staff Note
          </p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {message.body || '(empty note)'}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground/70 mt-1">
          {formatDateTime(message.createdAt)}
        </span>
      </div>
    )
  }

  const isInbound = direction === 'inbound'

  // §BUBBLE-COLORS:
  //   - inbound (customer): muted background, left aligned
  //   - outbound (staff): primary background, right aligned
  //   - Other directions: fall back to outbound styling (defensive).
  const bubbleClass = isInbound
    ? 'bg-muted text-foreground rounded-2xl rounded-tl-md'
    : 'bg-primary text-primary-foreground rounded-2xl rounded-tr-md'

  // §CREATE-COMPLAINT: Only inbound customer messages can spawn a complaint.
  // Hidden for outbound + non-in_app channels (showCreateComplaint flag).
  const handleCreateComplaint = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await apiPost(`/api/messages/${message.id}/create-complaint`, {})
      const complaintNumber = (res as any)?.complaint?.complaintNumber
      onComplaintCreated(complaintNumber || '—')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create complaint')
    } finally {
      setCreating(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
    >
      <div className={`flex flex-col max-w-[85%] ${isInbound ? 'items-start' : 'items-end'}`}>
        <div className={bubbleClass}>
          <p className="text-sm whitespace-pre-wrap break-words px-3 py-2">
            {message.body || '(no text)'}
          </p>
        </div>

        {/* §META-ROW: read state + timestamp + (optional) action */}
        <div className={`flex items-center gap-2 mt-1 px-1 ${isInbound ? '' : 'flex-row-reverse'}`}>
          <span className="text-[10px] text-muted-foreground">
            {formatDateTime(message.createdAt)}
          </span>
          {!isInbound && (
            <span className="text-[10px] inline-flex items-center gap-0.5 text-muted-foreground">
              {message.isRead ? (
                <>
                  <CheckCheck className="w-3 h-3 text-primary" />
                  <span className="sr-only">Read</span>
                </>
              ) : (
                <>
                  <Check className="w-3 h-3" />
                  <span className="sr-only">Sent</span>
                </>
              )}
            </span>
          )}
          {isInbound && !message.isRead && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary"
              aria-label="Unread"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              New
            </span>
          )}
        </div>

        {/* §CREATE-COMPLAINT: Inbound + in_app only */}
        {isInbound && showCreateComplaint && (
          <button
            type="button"
            onClick={handleCreateComplaint}
            disabled={creating}
            aria-label="Create complaint from this message"
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-60 px-2 py-1 rounded-lg transition-colors min-h-[28px]"
          >
            {creating ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <FileWarning className="w-3 h-3" />
                Create Complaint
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §REPLY-INPUT: Sticky composer at the bottom of the thread.
// Only rendered for in_app conversations.
// ─────────────────────────────────────────────────────────────────────────────

function ReplyInput({
  conversationId,
  onSent,
}: {
  conversationId: string
  onSent: (msg: Message) => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleSend = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await apiPost('/api/messages', {
        conversationId,
        direction: 'outbound',
        senderType: 'staff',
        body,
      })
      const msg = (res as any)?.message
      if (msg) {
        onSent(msg as Message)
        setText('')
        // §FOCUS: Keep keyboard open on mobile so the user can fire off multiple
        // replies without re-tapping the input.
        requestAnimationFrame(() => inputRef.current?.focus())
      } else {
        toast.error('Server did not return the new message')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }, [text, sending, conversationId, onSent])

  return (
    <div className="mt-3 flex items-center gap-2">
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        placeholder="Type a reply…"
        disabled={sending}
        aria-label="Reply message"
        className="flex-1 h-11 rounded-xl"
        maxLength={5000}
      />
      <Button
        onClick={handleSend}
        disabled={sending || !text.trim()}
        aria-label="Send message"
        className="h-11 w-11 p-0 shrink-0 rounded-xl"
      >
        {sending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §EXTERNAL-CHANNEL-BANNER: Tells the staff that replies are not yet wired up
// for external channels (WhatsApp, Telegram, etc.).
// ─────────────────────────────────────────────────────────────────────────────

function ExternalChannelBanner({ channel }: { channel: string }) {
  const meta = CHANNEL_META[channel]
  const label = meta?.label || channel
  return (
    <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200">
      <X className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {label} integration not yet available
        </p>
        <p className="text-[11px] mt-0.5 opacity-90">
          You can read inbound messages here, but replies require the {label} provider
          integration. Use the customer&apos;s phone or a separate {label} client to respond for now.
        </p>
      </div>
    </div>
  )
}
