'use client'

/**
 * PRD Part 32 §3.2 — AI Credit Trust Score Card
 *
 * Renders a party's AI-computed credit trust score (1.0–5.0★) with a
 * 5-star display (half-star aware), the suggested maximum credit line,
 * a human-readable reason, and a "Recalculate" action that forces the
 * backend to recompute via POST /api/trust-score/[partyId].
 *
 * Score color coding:
 *   ≥ 4.0  → emerald (healthy credit)
 *   3.0–3.9 → amber   (moderate risk)
 *   < 3.0  → red      (high risk)
 *
 * Variants:
 *   - full    (default): stars + score + suggested credit + reason + recalc.
 *   - compact: stars + score + suggested credit only (inline embedding).
 *
 * States: loading skeleton, error with retry, and loaded.
 */

import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Star,
  IndianRupee,
  RefreshCw,
  Loader2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { cn, formatCurrency } from '@/lib/utils'

export interface TrustScoreCardProps {
  partyId: string
  partyName?: string
  compact?: boolean
}

interface TrustScoreData {
  ok?: boolean
  partyId: string
  score: number
  maxCreditSuggestion: number
  reason: string
  breakdown: {
    onTimeRatio: number
    defaultRatio: number
    avgPaymentDays: number
    totalVolume: number
    [key: string]: number
  }
}

function scoreColor(score: number): string {
  if (score >= 4.0) return 'text-emerald-400'
  if (score >= 3.0) return 'text-amber-400'
  return 'text-red-400'
}

function scoreGlow(score: number): string {
  if (score >= 4.0) return 'bg-emerald-500/10 ring-emerald-500/20'
  if (score >= 3.0) return 'bg-amber-500/10 ring-amber-500/20'
  return 'bg-red-500/10 ring-red-500/20'
}

interface StarRatingProps {
  score: number
  color: string
  size?: 'sm' | 'md'
}

function StarRating({ score, color, size = 'md' }: StarRatingProps) {
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const clamped = Math.max(0, Math.min(5, score))

  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${score.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const fillFraction = Math.max(0, Math.min(1, clamped - (i - 1)))
        return (
          <div key={i} className={cn('relative', dim)}>
            {/* empty outline star (background) */}
            <Star
              className={cn(
                'absolute inset-0 text-muted-foreground/40',
                dim
              )}
              strokeWidth={1.5}
            />
            {/* filled star clipped to fillFraction */}
            {fillFraction > 0 && (
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fillFraction * 100}%` }}
              >
                <Star
                  className={cn('fill-current', color, dim)}
                  strokeWidth={1.5}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function TrustScoreCard({
  partyId,
  partyName,
  compact = false,
}: TrustScoreCardProps) {
  const { data, loading, error, refetch, setData } = useFetch<TrustScoreData>(
    `/api/trust-score/${partyId}`,
    [partyId]
  )

  const [recalculating, setRecalculating] = useState(false)

  const handleRecalculate = useCallback(async () => {
    setRecalculating(true)
    try {
      const result = (await apiPost(`/api/trust-score/${partyId}`, {})) as TrustScoreData
      setData(result)
      toast.success('Trust score recalculated', {
        description: `New score: ${result.score.toFixed(1)}★ • Suggested max credit ${formatCurrency(
          result.maxCreditSuggestion
        )}`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Recalculation failed', { description: msg })
    } finally {
      setRecalculating(false)
    }
  }, [partyId, setData])

  // ─── Loading skeleton ──────────────────────────────────────────────
  if (loading) {
    if (compact) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/80 px-3 py-2 backdrop-blur-xl">
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-4 w-4 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-3 flex-1" />
        </div>
      )
    }
    return (
      <Card className="border-border bg-card/80 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            AI Credit Trust Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-5 w-5 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-7 w-16" />
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </CardContent>
      </Card>
    )
  }

  // ─── Error state ───────────────────────────────────────────────────
  if (error || !data) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Trust score unavailable</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-red-300 hover:bg-red-500/10"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )
    }
    return (
      <Card className="border-red-500/30 bg-card/80 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-foreground">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            AI Credit Trust Score
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            Trust score unavailable
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const score = data.score
  const color = scoreColor(score)
  const glow = scoreGlow(score)
  const busy = recalculating

  // ─── Compact variant ───────────────────────────────────────────────
  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className={cn(
          'flex items-center gap-3 rounded-lg border border-border px-3 py-2 backdrop-blur-xl',
          glow
        )}
      >
        <StarRating score={score} color={color} size="sm" />
        <span className={cn('text-base font-bold tabular-nums', color)}>
          {score.toFixed(1)}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <IndianRupee className="h-3 w-3 text-emerald-400" />
          <span className="font-medium text-foreground">
            {formatCurrency(data.maxCreditSuggestion)}
          </span>
          <span className="hidden sm:inline">max</span>
        </span>
      </motion.div>
    )
  }

  // ─── Full variant ──────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
    >
      <Card className="border-border bg-card/80 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full ring-1',
                glow
              )}
            >
              <Sparkles className={cn('h-4 w-4', color)} />
            </span>
            AI Credit Trust Score
          </CardTitle>
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={busy}
              onClick={handleRecalculate}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {busy ? 'Recalculating…' : 'Recalculate'}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Score row: stars + big number */}
          <div className="flex items-center gap-3">
            <StarRating score={score} color={color} />
            <span
              className={cn(
                'text-3xl font-bold leading-none tabular-nums',
                color
              )}
            >
              {score.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground">/ 5.0</span>
          </div>

          {/* Suggested max credit */}
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
              'border-border bg-background/50'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full ring-1',
                  glow
                )}
              >
                <IndianRupee className={cn('h-4 w-4', color)} />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Suggested max credit
                </p>
                <p className="text-base font-semibold text-foreground">
                  {formatCurrency(data.maxCreditSuggestion)}
                </p>
              </div>
            </div>
            {partyName && (
              <span className="hidden text-xs text-muted-foreground sm:block">
                for {partyName}
              </span>
            )}
          </div>

          {/* Reason text */}
          {data.reason && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {data.reason}
            </p>
          )}

          {/* Breakdown chips */}
          {data.breakdown && (
            <div className="flex flex-wrap gap-1.5">
              <BreakdownChip
                label="On-time"
                value={`${data.breakdown.onTimeRatio ?? 0}%`}
                tone="emerald"
              />
              <BreakdownChip
                label="Defaults"
                value={`${data.breakdown.defaultRatio ?? 0}%`}
                tone={
                  (data.breakdown.defaultRatio ?? 0) > 0 ? 'red' : 'emerald'
                }
              />
              <BreakdownChip
                label="Avg pay"
                value={`${data.breakdown.avgPaymentDays ?? 0}d`}
                tone="amber"
              />
              <BreakdownChip
                label="Volume"
                value={formatCurrency(data.breakdown.totalVolume ?? 0)}
                tone="muted"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

interface BreakdownChipProps {
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'red' | 'muted'
}

function BreakdownChip({ label, value, tone }: BreakdownChipProps) {
  const toneClass = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    muted: 'border-border bg-background/50 text-muted-foreground',
  }[tone]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium',
        toneClass
      )}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )
}

export default TrustScoreCard
