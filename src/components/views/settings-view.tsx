'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPut, apiPost } from '@/hooks/use-fetch'
import { useTheme } from 'next-themes'
import { formatCurrency } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  Building2, Sliders, Database, Shield, Download, Upload, Save,
  Moon, Sun, Bell, Languages, Calendar, FileText, IndianRupee, Trash2, Sparkles, Palette, Mic, Keyboard,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { useState } from 'react'
import type { Business, AppSettingsData } from '@/lib/types'
import { PALETTES, usePaletteStore } from '@/store/palette-store'
import { useVoiceSettings } from '@/store/voice-settings-store'

const TABS = [
  { id: 'profile', labelKey: 'set.profile', icon: Building2 },
  { id: 'preferences', labelKey: 'set.preferences', icon: Sliders },
  { id: 'data', labelKey: 'set.data', icon: Database },
  { id: 'security', labelKey: 'set.security', icon: Shield },
] as const

export function SettingsView() {
  const { business, setBusiness, triggerRefresh } = useAppStore()
  const { t, language, setLanguage } = useI18n()
  const { theme, setTheme } = useTheme()
  const { activeId: activePaletteId, setPalette: setPaletteId } = usePaletteStore()
  const { globalVoiceEnabled, tapToVoiceEnabled, setGlobalVoice, setTapToVoice } = useVoiceSettings()
  const [tab, setTab] = useState<'profile' | 'preferences' | 'data' | 'security'>('profile')

  const { data: settings } = useFetch<AppSettingsData & { id: string }>('/api/app-settings', [])

  // Profile form state — sync from business (adjust during render to avoid effect setState)
  const [form, setForm] = useState<Partial<Business>>({})
  const [lastBizId, setLastBizId] = useState<string | null>(null)
  if (business && business.id !== lastBizId) {
    setLastBizId(business.id)
    setForm(business)
  }

  // Preferences state — sync from settings
  const [prefs, setPrefs] = useState({
    notificationsEnabled: true,
    autoBackupEnabled: false,
    language: 'en',
    dateFormat: 'DD/MM/YYYY',
    invoicePrefix: 'INV',
    pinEnabled: false,
  })
  // Phase 3 state
  const [pinEnabled, setPinEnabled] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [userRole, setRole] = useState<'owner' | 'manager' | 'sales'>('owner')
  const [lastSettingsId, setLastSettingsId] = useState<string | null>(null)
  if (settings && settings.id !== lastSettingsId) {
    setLastSettingsId(settings.id)
    setPinEnabled(settings.pinEnabled ?? false)
    setBiometricEnabled((settings as any).biometricEnabled ?? false)
    setRole(((settings as any).userRole as 'owner' | 'manager' | 'sales') ?? 'owner')
    setPrefs({
      notificationsEnabled: settings.notificationsEnabled,
      autoBackupEnabled: settings.autoBackupEnabled,
      language: settings.language,
      dateFormat: settings.dateFormat,
      invoicePrefix: settings.invoicePrefix,
      pinEnabled: settings.pinEnabled,
    })
  }

  const saveProfile = async () => {
    try {
      const updated = await apiPut('/api/business', form)
      setBusiness(updated)
      toast.success(t('set.saved'))
      triggerRefresh()
    } catch (e) {
      toast.error('Failed: ' + String(e))
    }
  }

  const savePrefs = async () => {
    try {
      await apiPut('/api/app-settings', prefs)
      setLanguage(prefs.language as any)
      toast.success(t('set.saved'))
    } catch (e) {
      toast.error('Failed: ' + String(e))
    }
  }

  const exportData = async (format: 'json' | 'csv') => {
    window.location.href = `/api/data-export?format=${format}`
    toast.success(`Exporting ${format.toUpperCase()}…`)
  }

  const reseed = async () => {
    if (!confirm('This will DELETE all parties, products, invoices, and transactions and re-seed fresh demo data. Continue?')) return
    try {
      toast.loading('Resetting data…')
      const res = await fetch('/api/reset', { method: 'POST' })
      if (!res.ok) throw new Error('Reset failed')
      toast.dismiss()
      toast.success('Demo data reset successfully!')
      // Reload the page to refresh all stores and data
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast.dismiss()
      toast.error('Reset failed: ' + String(e))
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {TABS.map((tb) => {
          const Icon = tb.icon
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] ${
                tab === tb.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t(tb.labelKey)}
            </button>
          )
        })}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {tab === 'profile' && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-emerald-700 flex items-center justify-center text-white">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{business?.name}</h3>
                <p className="text-[11px] text-muted-foreground">{business?.ownerName}</p>
              </div>
            </div>

            <Field label={t('set.businessName')} value={form.name || ''} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label={t('set.ownerName')} value={form.ownerName || ''} onChange={(v) => setForm({ ...form, ownerName: v })} />
            <Field label={t('set.phone')} value={form.phone || ''} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label={t('set.email')} value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label={t('set.state')} value={form.state || ''} onChange={(v) => setForm({ ...form, state: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('set.gstin')} value={form.gstin || ''} onChange={(v) => setForm({ ...form, gstin: v })} />
              <Field label={t('set.pan')} value={form.pan || ''} onChange={(v) => setForm({ ...form, pan: v })} />
            </div>
            <Field label={t('set.upiId')} value={form.upiId || ''} onChange={(v) => setForm({ ...form, upiId: v })} />
            <div>
              <Label className="text-xs mb-1.5 block">{t('set.address')}</Label>
              <Textarea
                value={form.address || ''}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t('set.currency')}</Label>
              <select
                value={form.currency || 'INR'}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full h-11 rounded-xl bg-muted px-3 text-sm border-0 outline-none"
              >
                {['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <Button onClick={saveProfile} className="w-full h-11">
              <Save className="w-4 h-4 mr-1.5" /> {t('set.save')}
            </Button>
          </Card>
        )}

        {tab === 'preferences' && (
          <Card className="p-5 space-y-5">
            {/* Dark mode */}
            <ToggleRow
              icon={theme === 'dark' ? Moon : Sun}
              label={t('set.darkMode')}
              checked={theme === 'dark'}
              onChange={(v) => setTheme(v ? 'dark' : 'light')}
            />

            {/* Color Palette Picker (PRD Part 23 §1) */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                  <Palette className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Color Palette</p>
                  <p className="text-[11px] text-muted-foreground">Choose accent color theme</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPaletteId(p.id)
                      toast.success(`Palette: ${p.label} ${p.emoji}`)
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                      activePaletteId === p.id ? 'border-primary' : 'border-border'
                    }`}
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <span className="text-[10px] font-medium">{p.label}</span>
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: p.light['--primary'] }}
                      />
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: p.light['--chart-2'] }}
                      />
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: p.light['--chart-3'] }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                  <Languages className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{t('set.language')}</p>
                  <p className="text-[11px] text-muted-foreground">English / বাংলা / हिन्दी</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 w-48">
                <button
                  onClick={() => { setLanguage('en'); setPrefs({ ...prefs, language: 'en' }) }}
                  className={`py-2 rounded-lg text-xs font-medium min-h-[40px] ${language === 'en' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  EN
                </button>
                <button
                  onClick={() => { setLanguage('bn'); setPrefs({ ...prefs, language: 'bn' }) }}
                  className={`py-2 rounded-lg text-xs font-medium min-h-[40px] ${language === 'bn' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  বাংলা
                </button>
                <button
                  onClick={() => { setLanguage('hi'); setPrefs({ ...prefs, language: 'hi' }) }}
                  className={`py-2 rounded-lg text-xs font-medium min-h-[40px] ${language === 'hi' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  हिन्दी
                </button>
              </div>
            </div>

            {/* Date format */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </span>
                <p className="text-sm font-medium">{t('set.dateFormat')}</p>
              </div>
              <select
                value={prefs.dateFormat}
                onChange={(e) => setPrefs({ ...prefs, dateFormat: e.target.value })}
                className="h-10 rounded-lg bg-muted px-3 text-xs border-0 outline-none"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>

            {/* Invoice prefix */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </span>
                <p className="text-sm font-medium">{t('set.invoicePrefix')}</p>
              </div>
              <Input
                value={prefs.invoicePrefix}
                onChange={(e) => setPrefs({ ...prefs, invoicePrefix: e.target.value })}
                className="w-28 h-10 text-sm"
              />
            </div>

            {/* Notifications */}
            <ToggleRow
              icon={Bell}
              label={t('set.notifications')}
              checked={prefs.notificationsEnabled}
              onChange={(v) => setPrefs({ ...prefs, notificationsEnabled: v })}
            />

            {/* Auto reminders */}
            <ToggleRow
              icon={Sparkles}
              label={t('set.autoReminders')}
              checked={prefs.autoBackupEnabled}
              onChange={(v) => setPrefs({ ...prefs, autoBackupEnabled: v })}
            />

            <Button onClick={savePrefs} className="w-full h-11">
              <Save className="w-4 h-4 mr-1.5" /> {t('set.save')}
            </Button>
          </Card>
        )}

        {tab === 'data' && (
          <div className="space-y-3">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">Local Export</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Download your business data for backup.</p>
              <div className="space-y-2">
                <Button variant="outline" onClick={() => exportData('json')} className="w-full h-11 justify-start">
                  <Download className="w-4 h-4 mr-2" /> {t('set.exportJson')}
                </Button>
                <Button variant="outline" onClick={() => exportData('csv')} className="w-full h-11 justify-start">
                  <FileText className="w-4 h-4 mr-2" /> {t('set.exportCsv')}
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">Cloud Backup</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Send your data to Telegram or Google Drive.</p>
              <div className="space-y-2">
                <Button variant="outline" onClick={async () => {
                  try {
                    toast.loading('Sending to Telegram…')
                    const res = await fetch('/api/backup/telegram', { method: 'POST' })
                    const data = await res.json()
                    toast.dismiss()
                    if (data.ok) {
                      toast.success(`Sent to Telegram — ${data.records?.parties || 0} parties, ${data.records?.invoices || 0} invoices`)
                      triggerRefresh()
                    } else throw new Error(data.error)
                  } catch (e) { toast.dismiss(); toast.error('Failed: ' + String(e)) }
                }} className="w-full h-11 justify-start">
                  <Upload className="w-4 h-4 mr-2" /> Send to Telegram
                </Button>
                <Button variant="outline" onClick={async () => {
                  try {
                    toast.loading('Uploading to Google Drive…')
                    const res = await fetch('/api/backup/drive', { method: 'POST' })
                    const data = await res.json()
                    toast.dismiss()
                    if (data.ok) {
                      toast.success(`Uploaded to Drive — ${data.records?.products || 0} products, ${data.records?.transactions || 0} transactions`)
                      triggerRefresh()
                    } else throw new Error(data.error)
                  } catch (e) { toast.dismiss(); toast.error('Failed: ' + String(e)) }
                }} className="w-full h-11 justify-start">
                  <Upload className="w-4 h-4 mr-2" /> Backup to Google Drive
                </Button>
                <Button variant="outline" onClick={async () => {
                  try {
                    const res = await fetch('/api/backup/list')
                    const logs = await res.json()
                    if (logs.length === 0) {
                      toast.info('No cloud backups yet')
                    } else {
                      const latest = logs[0]
                      toast.success(`Last backup: ${latest.channel} — ${new Date(latest.date).toLocaleString()}`)
                    }
                  } catch (e) { toast.error('Failed: ' + String(e)) }
                }} className="w-full h-11 justify-start">
                  <Database className="w-4 h-4 mr-2" /> Fetch Old Backup / Restore
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1 text-destructive">Danger Zone</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Reset demo data to default state.</p>
              <Button variant="outline" onClick={reseed} className="w-full h-11 text-destructive border-destructive/30">
                <Trash2 className="w-4 h-4 mr-2" /> Reset Demo Data
              </Button>
            </Card>
          </div>
        )}

        {tab === 'security' && (
          <div className="space-y-4">
            {/* PRD Part 26 §3: Voice & Input Settings */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Mic className="w-5 h-5 text-purple-600" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Voice & Input Settings</h3>
                  <p className="text-[11px] text-muted-foreground">গ্লোবাল ভয়েস ও ইনপুট কন্ট্রোল</p>
                </div>
              </div>

              {/* Toggle 1: Enable Global Voice Input */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Mic className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Enable Global Voice Input</p>
                    <p className="text-[10px] text-muted-foreground">টপ বারের মাইক ও ভয়েস কমান্ড সক্রিয়</p>
                  </div>
                </div>
                <Switch
                  checked={globalVoiceEnabled}
                  onCheckedChange={(v) => { setGlobalVoice(v); toast.success(`Global Voice ${v ? 'চালু' : 'বন্ধ'}`) }}
                />
              </div>

              {/* Toggle 2: Enable Tap-to-Voice / Double-Tap Keyboard */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Keyboard className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Tap-to-Voice / Double-Tap Keyboard</p>
                    <p className="text-[10px] text-muted-foreground">১-ক্লিকে মাইক, ২-ক্লিকে কীবোর্ড</p>
                  </div>
                </div>
                <Switch
                  checked={tapToVoiceEnabled}
                  onCheckedChange={(v) => { setTapToVoice(v); toast.success(`Tap-to-Voice ${v ? 'চালু' : 'বন্ধ'}`) }}
                />
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-emerald-600" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Security & Access</h3>
                  <p className="text-[11px] text-muted-foreground">Protect your business data</p>
                </div>
              </div>

              {/* App PIN Lock */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Shield className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">App PIN Lock</p>
                    <p className="text-[10px] text-muted-foreground">4-6 digit PIN</p>
                  </div>
                </div>
                <Switch
                  checked={pinEnabled}
                  onCheckedChange={async (v) => {
                    if (v) {
                      const pin = prompt('Enter a 4-6 digit PIN:')
                      if (pin && pin.length >= 4 && pin.length <= 6) {
                        const res = await fetch('/api/pin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'set', pin }),
                        })
                        if (res.ok) { setPinEnabled(true); toast.success('PIN set') }
                        else toast.error('Failed to set PIN')
                      } else { toast.error('PIN must be 4-6 digits') }
                    } else {
                      await fetch('/api/pin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'disable' }),
                      })
                      setPinEnabled(false)
                      toast.success('PIN disabled')
                    }
                  }}
                />
              </div>

              {/* Biometric fingerprint */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Shield className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Biometric Fingerprint</p>
                    <p className="text-[10px] text-muted-foreground">Customer recognition</p>
                  </div>
                </div>
                <Switch
                  checked={biometricEnabled}
                  onCheckedChange={async (v) => {
                    if (v) {
                      toast.info('Biometric enabled — register fingerprints from customer profiles')
                      setBiometricEnabled(true)
                    } else {
                      setBiometricEnabled(false)
                      toast.success('Biometric disabled')
                    }
                  }}
                />
              </div>

              <Button onClick={savePrefs} className="w-full h-11">
                <Save className="w-4 h-4 mr-1.5" /> Save Security Settings
              </Button>
            </Card>

            {/* RBAC Roles */}
            <Card className="p-5 space-y-3">
              <h3 className="text-sm font-semibold">User Role (RBAC)</h3>
              <p className="text-[11px] text-muted-foreground">Control access level for this device</p>
              <div className="grid grid-cols-3 gap-2">
                {(['owner', 'manager', 'sales'] as const).map((role) => (
                  <button
                    key={role}
                    onClick={async () => {
                      setRole(role)
                      await apiPut('/api/app-settings', { userRole: role })
                      toast.success(`Role set: ${role}`)
                    }}
                    className={`p-3 rounded-xl text-xs font-medium transition-all ${
                      role === userRole ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {role === 'owner' ? '👑 Owner' : role === 'manager' ? '👤 Manager' : '💼 Sales'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {userRole === 'owner' && 'Full access — all features, settings, delete, export'}
                {userRole === 'manager' && 'Daily operations — no delete, no settings change'}
                {userRole === 'sales' && 'Quick Sale Pad only + read-only Khata'}
              </p>
            </Card>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-11" />
    </div>
  )
}

function ToggleRow({ icon: Icon, label, checked, onChange }: { icon: any; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <p className="text-sm font-medium">{label}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
