'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Store,
  Navigation,
  MapPin,
  Package,
  AlertTriangle,
  Sparkles,
  Search,
  Loader2,
  Compass,
  ArrowRight,
  Smartphone,
  Info,
  Star,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types — matches /api/nearby-shops response shape
// ---------------------------------------------------------------------------
interface NearbyShop {
  id: string
  name: string
  ownerName: string | null
  address: string | null
  logoUrl: string | null
  storeSlug: string
  deliveryRadiusKm: number
  distance: number | null
  isSponsored: boolean
  productCount: number
  category: string
}

// ---------------------------------------------------------------------------
// Visual constants
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

// ---------------------------------------------------------------------------
// Shop avatar — logo image or first-letter gradient avatar
// ---------------------------------------------------------------------------
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
// Skeleton card
// ---------------------------------------------------------------------------
function ShopSkeletonCard() {
  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-xl bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted/70" />
        </div>
        <div className="h-6 w-16 rounded bg-muted/70" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-3/4 rounded bg-muted/60" />
        <div className="h-3 w-1/2 rounded bg-muted/60" />
      </div>
      <div className="mt-3 h-9 w-full rounded-lg bg-muted/60" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Distance formatting — compact for km
// ---------------------------------------------------------------------------
function formatDistance(km: number | null): string {
  if (km == null) return ''
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

// ---------------------------------------------------------------------------
// Shop card
// ---------------------------------------------------------------------------
function ShopCard({
  shop,
  index,
  showContactNote = false,
}: {
  shop: NearbyShop
  index: number
  showContactNote?: boolean
}) {
  const visit = () => {
    window.location.href = `/?store=${shop.storeSlug}`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.05, 0.4) }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`relative rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${
        shop.isSponsored
          ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-card'
          : 'border-border bg-card'
      }`}
    >
      {/* Featured ribbon */}
      {shop.isSponsored && (
        <div className="absolute -top-2.5 right-4 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 shadow-md">
          <Star className="h-3 w-3 fill-amber-950" />
          Featured
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start gap-3">
        <ShopAvatar name={shop.name} logoUrl={shop.logoUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">{shop.name}</h3>
          {shop.ownerName && (
            <p className="truncate text-xs text-muted-foreground">
              by {shop.ownerName}
            </p>
          )}
        </div>
      </div>

      {/* Address */}
      {shop.address && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{shop.address}</span>
        </div>
      )}

      {/* Meta badges row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {shop.distance != null ? (
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Navigation className="h-3 w-3" />
            {formatDistance(shop.distance)} away
          </Badge>
        ) : null}
        <Badge variant="outline" className="gap-1 text-[11px]">
          <Compass className="h-3 w-3" />
          Delivers within {shop.deliveryRadiusKm}km
        </Badge>
        <Badge variant="outline" className="gap-1 text-[11px]">
          <Package className="h-3 w-3" />
          {shop.productCount} {shop.productCount === 1 ? 'product' : 'products'}
        </Badge>
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px]"
        >
          {shop.category}
        </Badge>
      </div>

      {/* Contact note for out-of-bounds recommendations */}
      {showContactNote && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Contact shop to confirm delivery.</span>
        </div>
      )}

      {/* CTA */}
      <Button
        onClick={visit}
        className="mt-3 w-full gap-1.5"
        size="sm"
        aria-label={`Visit ${shop.name} store`}
      >
        Visit Store
        <ArrowRight className="h-4 w-4" />
      </Button>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Empty state — initial
// ---------------------------------------------------------------------------
function InitialEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center"
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <MapPin className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>
      <h3 className="text-base font-semibold">Find shops near you</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Allow location access or enter your area to discover nearby shops on the
        BizLedger network.
      </p>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Radar pulse — animated locating effect
// ---------------------------------------------------------------------------
function RadarPulse() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-6 py-10 text-center">
      <div className="relative mb-4 flex h-24 w-24 items-center justify-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border-2 border-emerald-500/40"
            animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeOut',
              delay: i * 0.6,
            }}
          />
        ))}
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 shadow-lg">
          <Navigation className="h-6 w-6 text-white" />
        </div>
      </div>
      <p className="text-sm font-medium">Detecting your location…</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Please allow location access in your browser.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
type Mode = 'idle' | 'gps-loading' | 'fetching' | 'done' | 'error'

export function MoreShopsView() {
  const [mode, setMode] = useState<Mode>('idle')
  const [shops, setShops] = useState<NearbyShop[]>([])
  const [allShops, setAllShops] = useState<NearbyShop[]>([])
  const [lastCoords, setLastCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [areaInput, setAreaInput] = useState('')
  const [activeQuery, setActiveQuery] = useState<{
    type: 'gps' | 'area'
    label: string
  } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ---- Fetch helpers ----
  const fetchByCoords = useCallback(async (lat: number, lng: number) => {
    setMode('fetching')
    setErrorMessage(null)
    setActiveQuery({ type: 'gps', label: 'Your current location' })
    setLastCoords({ lat, lng })
    try {
      const res = await fetch(`/api/nearby-shops?lat=${lat}&lng=${lng}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NearbyShop[] = await res.json()
      setShops(data)
      setMode('done')
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to fetch nearby shops')
      setMode('error')
    }
  }, [])

  const fetchByArea = useCallback(async (area: string) => {
    setMode('fetching')
    setErrorMessage(null)
    setActiveQuery({ type: 'area', label: area })
    try {
      const res = await fetch(`/api/nearby-shops?area=${encodeURIComponent(area)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NearbyShop[] = await res.json()
      setShops(data)
      setMode('done')
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to fetch shops for this area')
      setMode('error')
    }
  }, [])

  // Fetch ALL shops for the "Unserviceable Location" recommendation panel.
  // Uses ?all=1 (bypasses radius filter) — passes the customer's last known
  // coords so the backend can still attach a `distance` for sorting.
  const fetchAllShops = useCallback(async () => {
    try {
      const qs = lastCoords
        ? `?all=1&lat=${lastCoords.lat}&lng=${lastCoords.lng}`
        : '?all=1'
      const res = await fetch(`/api/nearby-shops${qs}`)
      if (!res.ok) return
      const data: NearbyShop[] = await res.json()
      setAllShops(data)
    } catch {
      /* best-effort */
    }
  }, [lastCoords])

  // GPS flow
  const handleUseLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Geolocation is not supported on this device.')
      setMode('error')
      setErrorMessage('Geolocation is not supported on this device.')
      return
    }
    setMode('gps-loading')
    setErrorMessage(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        void fetchByCoords(latitude, longitude)
      },
      (err) => {
        setMode('error')
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMessage(
            'Location permission denied. Enter your area name below to search instead.'
          )
          toast.error('Location denied — please enter your area name.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setErrorMessage('Location unavailable. Enter your area name below.')
          toast.error('Location unavailable.')
        } else if (err.code === err.TIMEOUT) {
          setErrorMessage('Location request timed out. Try again or enter area.')
          toast.error('Location timed out.')
        } else {
          setErrorMessage('Could not detect location. Enter your area name.')
          toast.error('Could not detect location.')
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    )
  }, [fetchByCoords])

  const handleAreaSearch = useCallback(() => {
    const area = areaInput.trim()
    if (!area) {
      toast.error('Please enter an area name.')
      return
    }
    void fetchByArea(area)
  }, [areaInput, fetchByArea])

  const handleReset = useCallback(() => {
    setMode('idle')
    setShops([])
    setAllShops([])
    setLastCoords(null)
    setActiveQuery(null)
    setErrorMessage(null)
    setAreaInput('')
  }, [])

  // When results are empty after a real search, opportunistically fetch all
  // shops so we can display recommendations.
  useEffect(() => {
    if (mode === 'done' && shops.length === 0) {
      void fetchAllShops()
    }
  }, [mode, shops.length, fetchAllShops])

  // Derived: out-of-bounds recommendations = nearest 3 shops from allShops
  // sorted by distance (nulls last). Only shown when customer used GPS and
  // no shop delivered to them.
  const recommendations = useMemo(() => {
    if (!allShops.length) return []
    return [...allShops]
      .sort((a, b) => {
        if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1
        const da = a.distance ?? Number.POSITIVE_INFINITY
        const db_ = b.distance ?? Number.POSITIVE_INFINITY
        return da - db_
      })
      .slice(0, 3)
  }, [allShops])

  const showUnserviceable = mode === 'done' && shops.length === 0
  const showContactNoteOnCards = showUnserviceable

  // ---- Add to Home Screen hint ----
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
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">More Shops Near You</h1>
            <p className="text-sm text-muted-foreground">
              Discover local merchants on the BizLedger network.
            </p>
          </div>
        </motion.header>

        {/* ---------- Location selector card ---------- */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Choose how to find shops
          </h2>

          {/* Option 1: GPS */}
          <Button
            onClick={handleUseLocation}
            disabled={mode === 'gps-loading' || mode === 'fetching'}
            className="w-full gap-2"
            variant="default"
          >
            {mode === 'gps-loading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Detecting…
              </>
            ) : (
              <>
                <Navigation className="h-4 w-4" />
                Use My Location
              </>
            )}
          </Button>

          {/* Divider */}
          <div className="my-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Option 2: Area search */}
          <div className="flex gap-2">
            <Input
              value={areaInput}
              onChange={(e) => setAreaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAreaSearch()
              }}
              placeholder="Enter area name (e.g. Salt Lake)"
              disabled={mode === 'gps-loading' || mode === 'fetching'}
              aria-label="Area name"
            />
            <Button
              onClick={handleAreaSearch}
              disabled={mode === 'gps-loading' || mode === 'fetching' || !areaInput.trim()}
              variant="secondary"
              className="gap-1.5"
              aria-label="Search by area"
            >
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>

          {/* Active query chip + reset */}
          {activeQuery && mode !== 'idle' && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <Badge
                variant="outline"
                className="gap-1 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              >
                <Compass className="h-3 w-3" />
                {activeQuery.label}
              </Badge>
              <button
                onClick={handleReset}
                className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                Reset
              </button>
            </div>
          )}
        </motion.section>

        {/* ---------- Body: idle / loading / error / results ---------- */}
        <section className="mt-6">
          <AnimatePresence mode="wait">
            {/* IDLE */}
            {mode === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <InitialEmptyState />
              </motion.div>
            )}

            {/* GPS LOADING */}
            {mode === 'gps-loading' && (
              <motion.div
                key="gps-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <RadarPulse />
              </motion.div>
            )}

            {/* FETCHING */}
            {mode === 'fetching' && (
              <motion.div
                key="fetching"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {[0, 1, 2].map((i) => (
                  <ShopSkeletonCard key={i} />
                ))}
              </motion.div>
            )}

            {/* ERROR */}
            {mode === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Couldn&apos;t find your location</p>
                    <p className="mt-1 text-xs">
                      {errorMessage ||
                        'Please try again or enter your area name above.'}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* DONE — unserviceable (no shops deliver) */}
            {mode === 'done' && showUnserviceable && (
              <motion.div
                key="unserv"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Red alert */}
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/20">
                      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-red-700 dark:text-red-300">
                        Unserviceable Location
                      </p>
                      <p className="mt-0.5 text-sm text-red-700/80 dark:text-red-300/80">
                        No shops deliver to your current location.
                      </p>
                    </div>
                  </div>
                </div>

                {/* AI recommendation amber card */}
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                      <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        AI Recommendation
                      </p>
                      <p className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-300/80">
                        Based on your area, here are the nearest shops that might
                        serve you. Contact the shop to confirm delivery.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Recommendations list */}
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                    <Store className="h-4 w-4" />
                    Nearby shops to explore
                  </h3>
                  {recommendations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
                      No shops available right now. Please check back later.
                    </div>
                  ) : (
                    <AnimatePresence>
                      {recommendations.map((s, i) => (
                        <ShopCard
                          key={s.id}
                          shop={s}
                          index={i}
                          showContactNote={showContactNoteOnCards}
                        />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </motion.div>
            )}

            {/* DONE — results */}
            {mode === 'done' && !showUnserviceable && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    {shops.length} {shops.length === 1 ? 'shop' : 'shops'} found
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    Sponsored first · then nearest
                  </span>
                </div>
                <AnimatePresence>
                  {shops.map((s, i) => (
                    <ShopCard key={s.id} shop={s} index={i} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
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

export default MoreShopsView
