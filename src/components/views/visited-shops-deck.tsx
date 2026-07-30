'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  History,
  Store,
  Trash2,
  Clock,
  ArrowRight,
  Compass,
  Smartphone,
  MapPin,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMounted } from '@/hooks/use-mounted'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Public: localStorage-backed visited shops history (PRD Part 33 §2.2).
// Used by StoreCatalogView to record visits, and by this deck to display them.
// ---------------------------------------------------------------------------
export interface VisitedShop {
  slug: string
  name: string
  logoUrl?: string | null
  visitedAt: number
}

const STORAGE_KEY = 'bizledger-visited-shops'
const MAX_HISTORY = 20

export function addVisitedShop(shop: {
  slug: string
  name: string
  logoUrl?: string | null
}) {
  if (typeof window === 'undefined') return
  const stored = localStorage.getItem(STORAGE_KEY)
  const list = stored ? JSON.parse(stored) : []
  // Remove if already exists (dedup)
  const filtered = list.filter((s: any) => s.slug !== shop.slug)
  // Add to front
  filtered.unshift({ ...shop, visitedAt: Date.now() })
  // Keep max 20
  const trimmed = filtered.slice(0, MAX_HISTORY)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

function readVisitedShops(): VisitedShop[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as VisitedShop[]) : []
  } catch {
    return []
  }
}

function writeVisitedShops(list: VisitedShop[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)))
}

// ---------------------------------------------------------------------------
// Time-ago formatter — relative, human readable.
// ---------------------------------------------------------------------------
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day} days ago`
  const week = Math.floor(day / 7)
  if (week === 1) return '1 week ago'
  if (week < 5) return `${week} weeks ago`
  const month = Math.floor(day / 30)
  if (month === 1) return '1 month ago'
  return `${month} months ago`
}

// ---------------------------------------------------------------------------
// Avatar gradients — mirrors store catalog avatar styling.
// ---------------------------------------------------------------------------
const AVATAR_GRADIENTS = [
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-sky-600',
  'from-lime-500 to-green-600',
]

function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function ShopAvatar({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string
  logoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'lg' ? 'h-16 w-16 text-xl' : size === 'sm' ? 'h-10 w-10 text-sm' : 'h-12 w-12 text-base'
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  const gradient = gradientFor(name || 'seed')

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${dim} rounded-xl object-cover border border-border/60 shadow-sm`}
      />
    )
  }
  return (
    <div
      className={`${dim} rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold shadow-sm`}
      aria-hidden
    >
      {initial}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visited shop card
// ---------------------------------------------------------------------------
function VisitedShopCard({
  shop,
  index,
  onRemove,
}: {
  shop: VisitedShop
  index: number
  onRemove: (slug: string) => void
}) {
  const visit = () => {
    window.location.href = `/?store=${shop.slug}`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.05, 0.4) }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="relative rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Remove button */}
      <button
        onClick={() => onRemove(shop.slug)}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
        aria-label={`Remove ${shop.name} from history`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* Avatar + name */}
      <div className="flex items-start gap-3 pr-6">
        <ShopAvatar name={shop.name} logoUrl={shop.logoUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">{shop.name}</h3>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Visited {timeAgo(shop.visitedAt)}
          </p>
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={visit}
        variant="secondary"
        size="sm"
        className="mt-3 w-full gap-1.5"
        aria-label={`Visit ${shop.name} again`}
      >
        Visit Again
        <ArrowRight className="h-4 w-4" />
      </Button>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Main deck component
// ---------------------------------------------------------------------------

// useSyncExternalStore plumbing — subscribes to `storage` events for cross-tab
// updates and to a custom in-tab event for same-window mutations.
const VISITED_EVENT = 'bizledger:visited-shops-changed'

function subscribeVisited(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', cb)
  window.addEventListener(VISITED_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(VISITED_EVENT, cb)
  }
}

function getVisitedSnapshot(): string {
  if (typeof window === 'undefined') return '[]'
  return localStorage.getItem(STORAGE_KEY) || '[]'
}

function getVisitedServerSnapshot(): string {
  return '[]'
}

export function VisitedShopsDeck() {
  const mounted = useMounted()
  const raw = useSyncExternalStore(
    subscribeVisited,
    getVisitedSnapshot,
    getVisitedServerSnapshot
  )
  const shops = useMemo<VisitedShop[]>(() => {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as VisitedShop[]) : []
    } catch {
      return []
    }
  }, [raw])
  // `loaded` becomes true after client hydration — gates the skeleton.
  const loaded = mounted

  const removeShop = useCallback((slug: string) => {
    const next = readVisitedShops().filter((s) => s.slug !== slug)
    writeVisitedShops(next)
    window.dispatchEvent(new Event(VISITED_EVENT))
    toast.success('Removed from history')
  }, [])

  const clearAll = useCallback(() => {
    if (!shops.length) return
    writeVisitedShops([])
    window.dispatchEvent(new Event(VISITED_EVENT))
    toast.success('History cleared')
  }, [shops.length])

  const discoverShops = useCallback(() => {
    window.location.href = '/?more-shops=1'
  }, [])

  const isEmpty = useMemo(() => loaded && shops.length === 0, [loaded, shops.length])

  // ---- Add to Home Screen hint (shared UX with More Shops) ----
  const showAddToHomeScreenHint = () => {
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isAndroid = /Android/.test(ua)
    if (isIOS) {
      toast.info(
        'Add to Home Screen: tap the Share icon in Safari, then "Add to Home Screen".',
        { duration: 6000 }
      )
    } else if (isAndroid) {
      toast.info(
        'Add to Home Screen: tap the ⋮ menu in Chrome, then "Add to Home screen".',
        { duration: 6000 }
      )
    } else {
      toast.info('Add to Home Screen: drag the URL to your desktop/taskbar.', {
        duration: 6000,
      })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 pb-16">
        {/* ---------- Header ---------- */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-start gap-3"
        >
          {/* §BACK-BUTTON: Return to previous page */}
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
            className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0 mt-1"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
            <History className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">My Visited Shops</h1>
            <p className="text-sm text-muted-foreground">
              Shops you&apos;ve recently visited on the BizLedger network.
            </p>
          </div>
        </motion.header>

        {/* ---------- Body ---------- */}
        <section className="mt-6">
          {/* Loading skeleton while reading localStorage */}
          {!loaded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-card p-4 shadow-sm animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-xl bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted/70" />
                    </div>
                  </div>
                  <div className="mt-3 h-9 w-full rounded-lg bg-muted/60" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center"
            >
              <div className="relative mb-4">
                <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                  <Store className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <h3 className="text-base font-semibold">No visited shops yet</h3>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Browse stores to build your history. Your recently visited shops
                will appear here for quick access.
              </p>
              <Button
                onClick={discoverShops}
                className="mt-4 gap-1.5"
                aria-label="Discover shops"
              >
                <Compass className="h-4 w-4" />
                Discover Shops
              </Button>
            </motion.div>
          )}

          {/* Visited shops grid (2 columns) */}
          {loaded && shops.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {shops.length} {shops.length === 1 ? 'shop' : 'shops'} visited
                </h2>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  Recently visited first
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <AnimatePresence>
                  {shops.map((s, i) => (
                    <VisitedShopCard
                      key={s.slug}
                      shop={s}
                      index={i}
                      onRemove={removeShop}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {/* Clear all */}
              <div className="pt-2 flex justify-center">
                <Button
                  onClick={clearAll}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear All History
                </Button>
              </div>
            </motion.div>
          )}
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="mt-auto border-t border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-2 px-4 py-4 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Powered by{' '}
            <span className="font-semibold text-foreground">BizLedger</span>
          </p>
          <button
            onClick={showAddToHomeScreenHint}
            className="flex items-center gap-1.5 text-xs text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <Smartphone className="h-3.5 w-3.5" />
            Add to Home Screen
          </button>
        </div>
      </footer>
    </div>
  )
}

export default VisitedShopsDeck
