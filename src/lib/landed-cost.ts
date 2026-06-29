export interface LandedCostInput { basePrice: number; transportFare: number; coolieCharge: number; quantity?: number }
export interface LandedCostResult { perUnitCost: number; totalCost: number; basePrice: number; transportFare: number; coolieCharge: number; quantity: number }
export function calcLandedCost(input: LandedCostInput): LandedCostResult {
  const qty = input.quantity ?? 1
  const perUnit = (input.basePrice || 0) + (input.transportFare || 0) + (input.coolieCharge || 0)
  return { perUnitCost: perUnit, totalCost: perUnit * qty, basePrice: input.basePrice || 0, transportFare: input.transportFare || 0, coolieCharge: input.coolieCharge || 0, quantity: qty }
}
export function findBestSupplier<T extends { id: string; basePrice: number; transportFare: number; coolieCharge: number }>(items: T[]): T | null {
  if (!items || items.length === 0) return null
  let best: T | null = null; let bestCost = Infinity
  for (const it of items) { const cost = (it.basePrice||0)+(it.transportFare||0)+(it.coolieCharge||0); if (cost < bestCost) { bestCost = cost; best = it } }
  return best
}
export function productSimilarity(nameA: string, nameB: string): number {
  const a = nameA.toLowerCase().trim(), b = nameB.toLowerCase().trim()
  if (!a || !b) return 0; if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  const tA = new Set(a.split(/\s+/)), tB = new Set(b.split(/\s+/))
  const inter = [...tA].filter(t => tB.has(t)).length
  const union = new Set([...tA, ...tB]).size
  const j = inter / union; if (j > 0.5) return j
  const dist = ((s1, s2) => { const m=s1.length, n=s2.length; if(!m) return n; if(!n) return m; const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0)); for(let i=0;i<=m;i++)dp[i][0]=i; for(let j=0;j<=n;j++)dp[0][j]=j; for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(s1[i-1]===s2[j-1]?0:1))} return dp[m][n] })(a,b)
  const maxLen = Math.max(a.length, b.length); return maxLen > 0 ? 1 - dist/maxLen : 0
}
export const SIMILARITY_THRESHOLD = 0.6
