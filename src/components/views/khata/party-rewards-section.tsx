'use client'

import { useFetch, apiPost } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { useState } from 'react'
import { Gift, Loader2, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// §PARTY-REWARDS-SECTION: Compact reward cycle progress on the customer profile.

interface RewardCycle {
  id: string
  cycleNumber: number
  threshold: number
  accumulatedProfit: number
  status: string
  startedAt: string
  unlockedAt: string | null
  rewardGivenAt: string | null
  rewardDescription: string | null
}

interface PastCycle {
  id: string
  cycleNumber: number
  threshold: number
  accumulatedProfit: number
  rewardGivenAt: string
  rewardDescription: string | null
  startedAt: string
  unlockedAt: string | null
}

interface RewardsData {
  partyId: string
  currentCycle: RewardCycle | null
  threshold: number
  accumulatedProfit: number
  progressPct: number
  status: string
  unlocked: boolean
  rewardHistory: PastCycle[]
}

export function PartyRewardsSection({ partyId }: { partyId: string }) {
  const { data, loading, error, refetch } = useFetch<RewardsData>(
    `/api/parties/${partyId}/rewards`,
    [partyId]
  )
  const [giving, setGiving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const handleGiveReward = async () => {
    if (!data?.currentCycle) return
    setGiving(true)
    try {
      await apiPost(`/api/parties/${partyId}/rewards/${data.currentCycle.id}/give`, {})
      toast.success('Reward given! New cycle started.')
      refetch()
    } catch (e: any) {
      toast.error(e.message || 'Failed to give reward')
    } finally {
      setGiving(false)
    }
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Gift className="w-4 h-4 text-purple-500" />
          Profit Rewards
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load rewards</p>
        </div>
      ) : !data ? (
        <p className="text-xs text-muted-foreground text-center py-4">No data</p>
      ) : (
        <div className="space-y-3">
          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium">
                {formatCurrency(data.accumulatedProfit)}
                <span className="text-muted-foreground"> / {formatCurrency(data.threshold)}</span>
              </span>
              <span className="text-muted-foreground">{data.progressPct}%</span>
            </div>
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  data.unlocked ? 'bg-purple-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, data.progressPct)}%` }}
              />
            </div>
          </div>

          {/* Status */}
          {data.unlocked ? (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50">
              <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
              <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
                Reward unlocked! Cycle #{data.currentCycle?.cycleNumber}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {formatCurrency(Math.max(0, data.threshold - data.accumulatedProfit))} until next reward · Cycle #{data.currentCycle?.cycleNumber ?? 1}
            </p>
          )}

          {/* Give Reward button */}
          {data.unlocked && data.currentCycle && (
            <button
              onClick={handleGiveReward}
              disabled={giving}
              className="w-full h-10 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
            >
              {giving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              {giving ? 'Processing...' : 'Give Reward'}
            </button>
          )}

          {/* Reward history */}
          {data.rewardHistory.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(v => !v)}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {data.rewardHistory.length} past reward{data.rewardHistory.length !== 1 ? 's' : ''}
              </button>
              <AnimatePresence>
                {showHistory && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1.5 mt-2">
                      {data.rewardHistory.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 text-xs">
                          <Gift className="w-3 h-3 text-purple-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">Cycle #{c.cycleNumber}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatCurrency(c.accumulatedProfit)} earned · {c.rewardDescription || 'Reward given'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
