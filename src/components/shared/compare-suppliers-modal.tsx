'use client'
import { useFetch } from '@/hooks/use-fetch'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Award, Truck, Hammer, Package, ShoppingCart, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useEffect } from 'react'
import type { SourcingCompareResult, SourcingMatch } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
interface Props { productId?: string | null; name?: string | null; category?: string | null; quantity?: number; open: boolean; onOpenChange: (open: boolean) => void; onSelectSupplier?: (supplierId: string, supplierName: string) => void }
export function CompareSuppliersModal({ productId, name, category, quantity = 1, open, onOpenChange, onSelectSupplier }: Props) {
  const query = productId ? `productId=${encodeURIComponent(productId)}` : `name=${encodeURIComponent(name||'')}${category?`&category=${encodeURIComponent(category)}`:''}`
  const { data, loading } = useFetch<any>(open ? `/api/sourcing/compare?${query}&quantity=${quantity}` : null, [open, productId, name, category, quantity])
  useEffect(() => { if (open && !loading && data && data.matches.length === 0) { const t = setTimeout(() => { toast.info('No suppliers currently stock this item'); onOpenChange(false) }, 1500); return () => clearTimeout(t) } }, [open, loading, data, onOpenChange])
  const handleOrder = (m: any) => { if (onSelectSupplier) { onSelectSupplier(m.supplierId, m.supplierName) } else { toast.success(`Ordering from ${m.supplierName}…`) }; onOpenChange(false) }
  return (
    <AnimatePresence>{open && (
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>onOpenChange(false)} className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center">
        <motion.div initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',stiffness:400,damping:32}} onClick={(e)=>e.stopPropagation()} className="bg-card rounded-t-3xl sm:rounded-3xl border-t sm:border border-border w-full max-w-lg max-h-[88vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border"><div className="min-w-0 flex-1"><p className="text-sm font-bold flex items-center gap-1.5"><Award className="w-4 h-4 text-emerald-600" /> Compare Suppliers</p><p className="text-[11px] text-muted-foreground truncate">{data?.productName || name || 'Product'} · Qty: {quantity}</p></div><button onClick={()=>onOpenChange(false)} className="text-muted-foreground p-1"><X className="w-4 h-4" /></button></div>
          <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-3">
            {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Comparing suppliers…</div> : !data || data.matches.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No matching suppliers found.</div> : (
              <><div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-800 dark:text-emerald-200"><p className="font-semibold mb-0.5">Total Landed Cost Formula:</p><p>Product Base Price + Transport Fare + Coolie Charges</p></div>
              {data.matches.map((m) => (
                <div key={m.catalogItemId} className={`p-4 rounded-2xl border-2 transition-all ${m.isBestChoice?'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30':'border-border bg-card'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2"><div className="min-w-0 flex-1"><p className="text-sm font-bold truncate">{m.supplierName}</p>{m.supplierPhone && <p className="text-[10px] text-muted-foreground">{m.supplierPhone}</p>}</div>{m.isBestChoice && <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-emerald-600 text-white flex items-center gap-1 shrink-0"><Star className="w-2.5 h-2.5 fill-current" /> LOWEST LANDED COST</span>}</div>
                  <div className="grid grid-cols-3 gap-2 mb-3"><div className="text-center p-2 rounded-lg bg-background/60"><Package className="w-3 h-3 mx-auto mb-0.5 text-muted-foreground" /><p className="text-[9px] text-muted-foreground uppercase">Base</p><p className="text-xs font-bold tabular">{formatCurrency(m.basePrice)}</p></div><div className="text-center p-2 rounded-lg bg-background/60"><Truck className="w-3 h-3 mx-auto mb-0.5 text-muted-foreground" /><p className="text-[9px] text-muted-foreground uppercase">Transport</p><p className="text-xs font-bold tabular">{formatCurrency(m.transportFare)}</p></div><div className="text-center p-2 rounded-lg bg-background/60"><Hammer className="w-3 h-3 mx-auto mb-0.5 text-muted-foreground" /><p className="text-[9px] text-muted-foreground uppercase">Coolie</p><p className="text-xs font-bold tabular">{formatCurrency(m.coolieCharge)}</p></div></div>
                  <div className="flex items-center justify-between mb-3 p-2 rounded-lg bg-background/80"><span className="text-xs text-muted-foreground">Per unit landed cost</span><span className={`text-base font-bold tabular ${m.isBestChoice?'text-emerald-600':''}`}>{formatCurrency(m.perUnitLandedCost)}</span></div>
                  <div className="flex items-center justify-between mb-3 text-xs"><span className="text-muted-foreground">Total for {quantity} unit(s)</span><span className="font-bold tabular">{formatCurrency(m.totalCostForQty)}</span></div>
                  <Button onClick={()=>handleOrder(m)} className={`w-full h-10 text-xs ${m.isBestChoice?'bg-emerald-600 hover:bg-emerald-700':''}`} variant={m.isBestChoice?'default':'outline'} size="sm"><ShoppingCart className="w-3.5 h-3.5 mr-1.5" />{m.isBestChoice?'Order from Best Choice':`Order from ${m.supplierName}`}</Button>
                </div>
              ))}</>
            )}
          </div>
        </motion.div>
      </motion.div>
    )}</AnimatePresence>
  )
}
