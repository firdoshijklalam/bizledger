'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  FileText, FileSpreadsheet, Printer, TrendingUp, TrendingDown,
  IndianRupee, Users, Package, BarChart3, AlertCircle, Receipt, ArrowLeftRight,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/shared/states'
import { toast } from 'sonner'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useState } from 'react'

const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#f97316', '#ef4444']

interface ReportData {
  business: any
  profitLoss: { revenue: number; expense: number; netProfit: number; gst: number; discount: number }
  gst: { totalGst: number; breakdown: Array<{ rate: number; taxable: number; gst: number }> }
  partyLedger: Array<{ id: string; name: string; type: string; grade: string; balance: number; phone?: string | null }>
  outstanding: {
    totalReceivable: number
    totalPayable: number
    receivables: Array<{ name: string; amount: number; grade: string }>
    payables: Array<{ name: string; amount: number }>
  }
  stockAgeing: Array<{ name: string; stock: number; value: number; threshold: number; status: string }>
  gradeDistribution: Array<{ grade: string; count: number; balance: number }>
  invoiceCount: number
  recentInvoices: Array<any>
}

export function ReportsView() {
  const { business, setActiveView } = useAppStore()
  const { t } = useI18n()
  const { data, loading } = useFetch<ReportData>('/api/reports', [])
  const [activeReport, setActiveReport] = useState<'pl' | 'gst' | 'party' | 'outstanding' | 'stock' | 'grade'>('pl')

  if (loading || !data) return <LoadingState />
  const currency = business?.currency || 'INR'
  const bizName = (business?.name || 'BizLedger').replace(/\s+/g, '_')

  const exportPdf = (type: string) => {
    toast.success(`Generating ${type} PDF…`)
    setTimeout(() => window.print(), 200)
  }

  const exportExcel = (type: string) => {
    toast.success(`Excel export started for ${type}`)
    // Trigger CSV-style export as fallback
    const rows: string[] = []
    if (type === 'P&L') {
      rows.push('Metric,Amount')
      rows.push(`Revenue,${data.profitLoss.revenue}`)
      rows.push(`Expense,${data.profitLoss.expense}`)
      rows.push(`Net Profit,${data.profitLoss.netProfit}`)
      rows.push(`GST,${data.profitLoss.gst}`)
      rows.push(`Discount,${data.profitLoss.discount}`)
    } else if (type === 'Party Ledger') {
      rows.push('Name,Type,Grade,Balance,Phone')
      data.partyLedger.forEach((p) => rows.push(`${p.name},${p.type},${p.grade},${p.balance},${p.phone || ''}`))
    } else if (type === 'Outstanding') {
      rows.push('Name,Amount,Type')
      data.outstanding.receivables.forEach((r) => rows.push(`${r.name},${r.amount},Receivable`))
      data.outstanding.payables.forEach((p) => rows.push(`${p.name},${p.amount},Payable`))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bizName}_${type.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${type} exported`)
  }

  const REPORTS = [
    { id: 'pl', label: t('rep.pl'), icon: TrendingUp },
    { id: 'gst', label: t('rep.gst'), icon: IndianRupee },
    { id: 'party', label: t('rep.partyLedger'), icon: Users },
    { id: 'outstanding', label: t('rep.outstanding'), icon: AlertCircle },
    { id: 'stock', label: t('rep.stockAgeing'), icon: Package },
    { id: 'grade', label: t('rep.gradeDist'), icon: BarChart3 },
  ] as const

  return (
    <div className="space-y-4">
      {/* Report selector */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {REPORTS.map((r) => {
          const Icon = r.icon
          return (
            <button
              key={r.id}
              onClick={() => setActiveReport(r.id as any)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] ${
                activeReport === r.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {r.label}
            </button>
          )
        })}
      </div>

      {/* Export buttons */}
      <div className="grid grid-cols-3 gap-2 action-buttons">
        <Button variant="outline" onClick={() => exportPdf(REPORTS.find((r) => r.id === activeReport)!.label)} className="h-11 flex-col text-xs">
          <FileText className="w-4 h-4 mb-0.5" /> {t('rep.downloadPdf')}
        </Button>
        <Button variant="outline" onClick={() => exportExcel(REPORTS.find((r) => r.id === activeReport)!.label)} className="h-11 flex-col text-xs">
          <FileSpreadsheet className="w-4 h-4 mb-0.5" /> {t('rep.exportExcel')}
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="h-11 flex-col text-xs">
          <Printer className="w-4 h-4 mb-0.5" /> {t('rep.print')}
        </Button>
      </div>

      {/* Report content */}
      <motion.div
        key={activeReport}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="print-area space-y-4"
      >
        {activeReport === 'pl' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.pl')}</h3>
            <div className="space-y-3">
              <Row icon={TrendingUp} label={t('rep.revenue')} value={formatCurrency(data.profitLoss.revenue, currency)} color="text-emerald-600" />
              <Row icon={TrendingDown} label={t('rep.expense')} value={formatCurrency(data.profitLoss.expense, currency)} color="text-red-600" />
              <Row icon={IndianRupee} label="GST Collected" value={formatCurrency(data.profitLoss.gst, currency)} color="text-amber-600" />
              <Row icon={IndianRupee} label="Discounts Given" value={formatCurrency(data.profitLoss.discount, currency)} color="text-purple-600" />
              <div className="pt-3 border-t border-border">
                <Row icon={BarChart3} label={t('rep.netProfit')} value={formatCurrency(data.profitLoss.netProfit, currency)} color={data.profitLoss.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} bold />
              </div>
            </div>
          </Card>
        )}

        {activeReport === 'gst' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.gst')}</h3>
            <div className="text-center py-4 mb-4">
              <p className="text-xs text-muted-foreground">Total GST Collected</p>
              <p className="text-3xl font-bold tabular text-amber-600">{formatCurrency(data.gst.totalGst, currency)}</p>
            </div>
            {data.gst.breakdown.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Rate-wise Breakdown</p>
                {data.gst.breakdown.map((b) => (
                  <div key={b.rate} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 text-sm">
                    <div>
                      <p className="font-medium">{b.rate}% GST</p>
                      <p className="text-[11px] text-muted-foreground">Taxable: {formatCurrency(b.taxable, currency)}</p>
                    </div>
                    <p className="font-semibold tabular text-amber-600">{formatCurrency(b.gst, currency)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {activeReport === 'party' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.partyLedger')} ({data.partyLedger.length})</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-area">
              {data.partyLedger.map((p) => {
                const meta = GRADE_META[p.grade]
                return (
                  <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/50">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700 text-sm">
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{p.type}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular ${p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {formatCurrency(Math.abs(p.balance), currency)}
                      </p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{p.grade}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {activeReport === 'outstanding' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border-transparent">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">{t('rep.totalReceivable')}</p>
                <p className="text-xl font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(data.outstanding.totalReceivable, currency)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{data.outstanding.receivables.length} parties</p>
              </Card>
              <Card className="p-4 bg-red-50 dark:bg-red-950/30 border-transparent">
                <p className="text-xs text-red-700 dark:text-red-300">{t('rep.totalPayable')}</p>
                <p className="text-xl font-bold tabular text-red-700 dark:text-red-300">{formatCurrency(data.outstanding.totalPayable, currency)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{data.outstanding.payables.length} suppliers</p>
              </Card>
            </div>
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Receivables (পাবো)</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto scroll-area">
                {data.outstanding.receivables.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${GRADE_META[r.grade]?.bg}`} />
                      {r.name}
                    </span>
                    <span className="font-semibold tabular text-emerald-600">{formatCurrency(r.amount, currency)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeReport === 'stock' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.stockAgeing')}</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-area">
              {data.stockAgeing.map((s) => (
                <div key={s.name} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.stock} units · {formatCurrency(s.value, currency)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                    s.status === 'low' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : s.status === 'medium' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {s.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {activeReport === 'grade' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.gradeDist')}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.gradeDistribution}
                    dataKey="count"
                    nameKey="grade"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e: any) => `${e.grade}: ${e.count}`}
                  >
                    {data.gradeDistribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-4">
              {data.gradeDistribution.map((g, i) => {
                const meta = GRADE_META[g.grade]
                return (
                  <div key={g.grade} className="flex items-center gap-3 p-2 rounded-lg">
                    <span className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <div className="flex-1">
                      <span className={`text-sm font-bold ${meta.color}`}>Grade {g.grade}</span>
                      <span className="text-[11px] text-muted-foreground ml-2">{meta.desc}</span>
                    </div>
                    <span className="text-sm font-semibold tabular">{g.count} parties</span>
                    <span className="text-xs text-muted-foreground tabular">{formatCurrency(g.balance, currency)}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </motion.div>

      {/* Recent invoices summary — clickable (PRD Part 3 §3.1) */}
      <Card className="p-5 no-print">
        <h3 className="text-sm font-semibold mb-3">Recent Invoices</h3>
        <div className="space-y-2">
          {data.recentInvoices.slice(0, 5).map((inv) => (
            <button
              key={inv.id}
              onClick={() => {
                useAppStore.getState().setSelectedInvoiceId(inv.id)
                useAppStore.getState().setActiveView('billing')
              }}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
            >
              <Receipt className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{inv.number}</p>
                <p className="text-[11px] text-muted-foreground">{inv.party} · {formatDate(inv.date)}</p>
              </div>
              <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(inv.total, currency)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Row({
  icon: Icon, label, value, color, bold,
}: { icon: any; label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-8 h-8 rounded-lg bg-muted flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className={`flex-1 text-sm ${bold ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`tabular ${bold ? 'text-lg font-bold' : 'text-sm font-semibold'} ${color}`}>{value}</span>
    </div>
  )
}
