'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { formatCurrency, formatDate } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, UserPlus, X, QrCode, Trash2, Shield, Sparkles,
  CheckCircle2, Clock, FileEdit, Receipt, Package, BookOpen,
  BarChart3, Store, Settings, Download, AlertCircle, History,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useState, useMemo } from 'react'

interface Staff {
  id: string
  name: string
  phone: string | null
  role: string
  staffId: string
  qrToken: string
  isActive: boolean
  permBilling: boolean
  permInventory: boolean
  permKhata: boolean
  permReports: boolean
  permSourcing: boolean
  permSettings: boolean
  permExport: boolean
  permDelete: boolean
  createdAt: string
}

interface AuditLogEntry {
  id: string
  staffName: string
  action: string
  entityType: string
  description: string
  createdAt: string
}

// PRD Part 31 §2: Permission grid items
const PERMISSIONS = [
  { key: 'permBilling', label: 'Billing & Invoicing', icon: Receipt },
  { key: 'permInventory', label: 'Inventory & Stock', icon: Package },
  { key: 'permKhata', label: 'Customer Khata', icon: BookOpen },
  { key: 'permReports', label: 'Reports & Analytics', icon: BarChart3 },
  { key: 'permSourcing', label: 'B2B Sourcing', icon: Store },
  { key: 'permSettings', label: 'Settings', icon: Settings },
  { key: 'permExport', label: 'Data Export', icon: Download },
  { key: 'permDelete', label: 'Delete Records', icon: Trash2 },
] as const

// PRD Part 31 §2: AI recommended permissions per role
const AI_RECOMMENDATIONS: Record<string, Record<string, boolean>> = {
  manager: {
    permBilling: true, permInventory: true, permKhata: true, permReports: true,
    permSourcing: true, permSettings: false, permExport: false, permDelete: false,
  },
  sales: {
    permBilling: true, permInventory: false, permKhata: false, permReports: false,
    permSourcing: false, permSettings: false, permExport: false, permDelete: false,
  },
}

export function StaffManagementView() {
  const { business, triggerRefresh } = useAppStore()
  const { t } = useI18n()
  const { data: staff, loading, refetch } = useFetch<Staff[]>('/api/staff', [])
  const { data: auditLogs } = useFetch<AuditLogEntry[]>('/api/audit-log', [])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showQrFor, setShowQrFor] = useState<Staff | null>(null)
  const [activeTab, setActiveTab] = useState<'staff' | 'audit'>('staff')

  // Add staff form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'manager' | 'sales'>('sales')
  const [perms, setPerms] = useState<Record<string, boolean>>({
    permBilling: true, permInventory: false, permKhata: false, permReports: false,
    permSourcing: false, permSettings: false, permExport: false, permDelete: false,
  })
  const [saving, setSaving] = useState(false)

  const currency = business?.currency || 'INR'

  // PRD Part 31 §2: AI auto-recommend when role changes
  const handleRoleChange = (newRole: 'manager' | 'sales') => {
    setRole(newRole)
    const recommended = AI_RECOMMENDATIONS[newRole]
    if (recommended) {
      setPerms({ ...recommended })
      if (newRole === 'sales') {
        toast.info(`🤖 ${t('staff.aiSales')}`)
      } else {
        toast.info(`🤖 ${t('staff.aiManager')}`)
      }
    }
  }

  const handleTogglePerm = (key: string) => {
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleAddStaff = async () => {
    if (!name.trim()) { toast.error(t('staff.noName')); return }
    setSaving(true)
    try {
      await apiPost('/api/staff', { name, phone, role, ...perms })
      toast.success(t('staff.added').replace('{name}', name))
      refetch()
      triggerRefresh()
      setName(''); setPhone(''); setRole('sales')
      setPerms(AI_RECOMMENDATIONS.sales)
      setShowAddModal(false)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/staff/${id}`, { method: 'DELETE' })
      toast.success('Staff removed')
      refetch()
      triggerRefresh()
    } catch (e) {
      toast.error('Failed')
    }
  }

  // Generate QR string for staff
  const getQrString = (s: Staff) => {
    return JSON.stringify({ staffId: s.staffId, token: s.qrToken, business: business?.name })
  }

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Staff Management
          </h2>
          <p className="text-[11px] text-muted-foreground">{t('staff.sub')}</p>
        </div>
      </div>

      {/* PRD Part 31 §3: Multi-Business Switch
          §STAFF-STYLE: was a blue→indigo gradient (indigo is off-palette) —
          emerald/teal tint matches the app's business/active semantics. */}
      <Card className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">{t('staff.activeBiz')}</p>
              <p className="text-[10px] text-muted-foreground">{business?.name || 'BizLedger'}</p>
            </div>
          </div>
          <button
            onClick={() => toast.info(t('staff.switchHint'))}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors min-h-[36px]"
          >
            Switch Business
          </button>
        </div>
      </Card>

      {/* Tab: Staff List / Audit Log — segmented control
          §STAFF-TABS (VLM round 9): the previous bg-card-only active state still
          read as "disabled label". Active now gets the app-wide emerald-tinted
          PILL treatment (mirrors the Settings tab pills) — unambiguous. */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted" role="tablist" aria-label="Staff / Audit Log">
        <button
          role="tab"
          aria-selected={activeTab === 'staff'}
          onClick={() => setActiveTab('staff')}
          className={`flex-1 py-2 rounded-lg text-xs min-h-[40px] transition-colors ${
            activeTab === 'staff'
              ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25 shadow-sm font-semibold'
              : 'text-muted-foreground font-medium hover:text-foreground'
          }`}
        >
          <Users className={`w-3.5 h-3.5 inline mr-1 ${activeTab === 'staff' ? 'text-emerald-600 dark:text-emerald-400' : ''}`} /> Staff ({staff?.length || 0})
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'audit'}
          onClick={() => setActiveTab('audit')}
          className={`flex-1 py-2 rounded-lg text-xs min-h-[40px] transition-colors ${
            activeTab === 'audit'
              ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25 shadow-sm font-semibold'
              : 'text-muted-foreground font-medium hover:text-foreground'
          }`}
        >
          <History className={`w-3.5 h-3.5 inline mr-1 ${activeTab === 'audit' ? 'text-emerald-600 dark:text-emerald-400' : ''}`} /> Audit Log
        </button>
      </div>

      {/* Staff List */}
      {activeTab === 'staff' && (
        <>
          {/* §EMPTY-STATE (VLM round 9): the previous layout — a full-width CTA
              button + a distant muted EmptyState below — read as "broken bottom
              half" with a massive dead gap. The empty state is now ONE designed
              card: tinted icon (contrast), strong heading, and the CTA INSIDE
              the state so the action lives where the explanation is. */}
          {loading ? <LoadingState /> : !staff || staff.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-dashed border-border bg-muted/30 dark:bg-muted/10 px-6 py-8 flex flex-col items-center text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 ring-1 ring-emerald-500/25 flex items-center justify-center mb-3">
                <UserPlus className="w-7 h-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">No staff added yet</h3>
              <p className="text-xs text-muted-foreground max-w-[260px] mt-1 mb-4">{t('staff.empty')}</p>
              <Button onClick={() => setShowAddModal(true)} className="h-11 px-6">
                <UserPlus className="w-4 h-4 mr-2" /> Add New Staff
              </Button>
            </motion.div>
          ) : (
            <>
              <Button onClick={() => setShowAddModal(true)} className="w-full h-12">
                <UserPlus className="w-5 h-5 mr-2" /> Add New Staff
              </Button>
              <div className="space-y-2">
              <AnimatePresence>
                {staff.map((s, i) => (
                  <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <Card className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${s.role === 'manager' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                          <Users className={`w-5 h-5 ${s.role === 'manager' ? 'text-emerald-600' : 'text-amber-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{s.name}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${s.role === 'manager' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                              {s.role === 'manager' ? '👤 Manager' : '💼 Sales'}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{s.phone || 'No phone'} · ID: {s.staffId}</p>
                          {/* Active permissions */}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {PERMISSIONS.filter(p => (s as any)[p.key]).map(p => {
                              const Icon = p.icon
                              return <span key={p.key} className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-0.5"><Icon className="w-2 h-2" />{p.label.split(' ')[0]}</span>
                            })}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button onClick={() => setShowQrFor(s)} className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center" title="QR Code">
                            <QrCode className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(s.id)} className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
              </div>
            </>
          )}
        </>
      )}

      {/* PRD Part 31 §4: Audit Log */}
      {activeTab === 'audit' && (
        <div className="space-y-2">
          {!auditLogs || auditLogs.length === 0 ? (
            <EmptyState icon={History} title="No activity logged yet" description={t('staff.auditEmpty')} />
          ) : (
            <AnimatePresence>
              {auditLogs.map((log, i) => (
                <motion.div key={log.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <Card className="p-3">
                    <div className="flex items-start gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        log.action.includes('delete') ? 'bg-red-100 dark:bg-red-900/30' :
                        log.action.includes('create') ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                        'bg-teal-100 dark:bg-teal-900/30'
                      }`}>
                        {log.action.includes('delete') ? <Trash2 className="w-3.5 h-3.5 text-red-600" /> :
                         log.action.includes('create') ? <Receipt className="w-3.5 h-3.5 text-emerald-600" /> :
                         <FileEdit className="w-3.5 h-3.5 text-teal-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{log.description}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {log.staffName} · {log.action} · {formatDate(log.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* PRD Part 31 §1: Add Staff Modal with AI Permission Grid */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <FormDialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Add New Staff
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('staff.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" placeholder="Rahul Sharma" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('staff.phone')}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" placeholder="+91 90000 12345" />
            </div>
            {/* Role selector with AI recommendation */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('staff.role')}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => handleRoleChange('manager')} className={`p-3 rounded-xl text-xs font-medium transition-all ${role === 'manager' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  👤 Manager
                </button>
                <button onClick={() => handleRoleChange('sales')} className={`p-3 rounded-xl text-xs font-medium transition-all ${role === 'sales' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  💼 Salesman
                </button>
              </div>
            </div>
            {/* PRD Part 31 §2: AI Permission Checkbox Grid */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <Label className="text-xs font-semibold">{t('staff.permGrid')}</Label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSIONS.map((p) => {
                  const Icon = p.icon
                  const isChecked = perms[p.key]
                  return (
                    <button
                      key={p.key}
                      onClick={() => handleTogglePerm(p.key)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left ${
                        isChecked ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border bg-muted/30'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isChecked ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                      <span className={`text-[10px] flex-1 ${isChecked ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{p.label}</span>
                      {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                    </button>
                  )
                })}
              </div>
              <p className="text-[9px] text-muted-foreground">🤖 {t('staff.permHint')}</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddModal(false)} className="h-11">{t('common.cancel')}</Button>
            <Button onClick={handleAddStaff} disabled={saving || !name.trim()} className="h-11 flex-1">
              {saving ? t('staff.adding') : t('staff.add')}
            </Button>
          </DialogFooter>
        </FormDialogContent>
      </Dialog>

      {/* PRD Part 31 §1: QR Code Modal */}
      <Dialog open={!!showQrFor} onOpenChange={(o) => !o && setShowQrFor(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">Staff QR Code</DialogTitle>
          </DialogHeader>
          {showQrFor && (
            <div className="text-center space-y-3 py-2">
              <p className="text-sm font-semibold">{showQrFor.name}</p>
              <p className="text-[10px] text-muted-foreground">Staff ID: <span className="font-bold tabular text-primary">{showQrFor.staffId}</span></p>
              {/* QR pattern */}
              <div className="w-40 h-40 mx-auto bg-white rounded-xl p-3 flex items-center justify-center border-2 border-border">
                <div className="grid grid-cols-10 gap-0.5 w-32 h-32">
                  {Array.from({ length: 100 }).map((_, idx) => {
                    const hash = showQrFor.qrToken.charCodeAt(idx % showQrFor.qrToken.length) + idx
                    return <div key={idx} className={`${hash % 2 === 0 ? 'bg-black' : 'bg-white'} rounded-[1px]`} />
                  })}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">{t('staff.qrHint')}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 h-9 text-xs" onClick={() => { toast.success(t('staff.qrCopied')); navigator.clipboard?.writeText(getQrString(showQrFor)) }}>
                  Copy Token
                </Button>
                <Button size="sm" className="flex-1 h-9 text-xs" onClick={() => setShowQrFor(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
