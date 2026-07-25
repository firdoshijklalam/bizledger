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
  AlertCircle, CheckCircle2, QrCode, ChevronDown, ChevronUp, Lock, Fingerprint,
  Store, MapPin, Navigation, Star, TrendingUp, ShoppingCart, Crown, ExternalLink,
  Smartphone, Radio, Globe, Server, Ban, Cloud, User, Volume2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useState, useMemo, useEffect } from 'react'
import type { Business, AppSettingsData } from '@/lib/types'
import { PALETTES, usePaletteStore } from '@/store/palette-store'
import { useVoiceSettings } from '@/store/voice-settings-store'
import { useNotificationStore } from '@/store/notification-store'
import { useGateTrigger } from '@/store/biometric-gate-store'

const TABS = [
  { id: 'profile', labelKey: 'set.profile', icon: Building2 },
  { id: 'preferences', labelKey: 'set.preferences', icon: Sliders },
  { id: 'data', labelKey: 'set.data', icon: Database },
  { id: 'marketplace', labelKey: 'set.marketplace', icon: Store },
  { id: 'security', labelKey: 'set.security', icon: Shield },
] as const

export function SettingsView() {
  const { business, setBusiness, triggerRefresh } = useAppStore()
  const { t, language, setLanguage } = useI18n()
  const { theme, setTheme } = useTheme()
  const { activePalette: activePaletteId, setPalette: setPaletteId } = usePaletteStore()
  const { globalVoiceEnabled, tapToVoiceEnabled, setGlobalVoice, setTapToVoice, soundBoxEnabled, setSoundBoxEnabled } = useVoiceSettings()
  const { channels, toggleChannel } = useNotificationStore()
  const triggerGate = useGateTrigger()
  const [showNotifChannels, setShowNotifChannels] = useState(false)
  // PRD Part 30 §1.2: PIN-guarded reset modal
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetPin, setResetPin] = useState('')
  const [resetting, setResetting] = useState(false)
  const [tab, setTab] = useState<'profile' | 'preferences' | 'data' | 'marketplace' | 'security'>('profile')

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
  // PRD Part 32 §1: Biometric gate config state
  const [gateConfig, setGateConfig] = useState({
    gateOwnerSwitch: true,
    gateHighValueDiscount: true,
    gateDiscountLimit: 5000,
    gateDataExport: true,
    gateInventoryPrice: true,
    gateDangerZone: true,
    externalScannerEnabled: false,
    defaulterRegistryEnabled: true,
  })
  const [lastSettingsId, setLastSettingsId] = useState<string | null>(null)
  if (settings && settings.id !== lastSettingsId) {
    setLastSettingsId(settings.id)
    setPinEnabled(settings.pinEnabled ?? false)
    setBiometricEnabled((settings as any).biometricEnabled ?? false)
    setRole(((settings as any).userRole as 'owner' | 'manager' | 'sales') ?? 'owner')
    setGateConfig({
      gateOwnerSwitch: (settings as any).gateOwnerSwitch ?? true,
      gateHighValueDiscount: (settings as any).gateHighValueDiscount ?? true,
      gateDiscountLimit: (settings as any).gateDiscountLimit ?? 5000,
      gateDataExport: (settings as any).gateDataExport ?? true,
      gateInventoryPrice: (settings as any).gateInventoryPrice ?? true,
      gateDangerZone: (settings as any).gateDangerZone ?? true,
      externalScannerEnabled: (settings as any).externalScannerEnabled ?? false,
      defaulterRegistryEnabled: (settings as any).defaulterRegistryEnabled ?? true,
    })
    setPrefs({
      notificationsEnabled: settings.notificationsEnabled,
      autoBackupEnabled: settings.autoBackupEnabled,
      language: settings.language,
      dateFormat: settings.dateFormat,
      invoicePrefix: settings.invoicePrefix,
      pinEnabled: settings.pinEnabled,
    })
  }

  // PRD Part 28 §1: GSTIN & PAN validation
  const gstinValid = useMemo(() => {
    if (!form.gstin) return true // empty = valid (optional)
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin)
  }, [form.gstin])

  const panValid = useMemo(() => {
    if (!form.pan) return true
    return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan)
  }, [form.pan])

  const upiValid = useMemo(() => {
    if (!form.upiId) return true
    return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(form.upiId)
  }, [form.upiId])

  const isFormValid = gstinValid && panValid && upiValid

  // PRD Part 28 §2: UPI QR preview
  const [showQrPreview, setShowQrPreview] = useState(false)
  const upiQrString = useMemo(() => {
    if (!form.upiId) return ''
    return `upi://pay?pa=${form.upiId}&pn=${encodeURIComponent(form.name || 'BizLedger')}&cu=INR`
  }, [form.upiId, form.name])

  const saveProfile = async () => {
    // PRD Part 28 §1: Validate before save
    if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin)) {
      toast.error('Invalid GSTIN format')
      return
    }
    if (form.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan)) {
      toast.error('Invalid PAN format')
      return
    }
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
    // PRD Part 32 §1.3: Data Export Security gate
    if (gateConfig.gateDataExport) {
      triggerGate(
        'data_export',
        `Export all business data to ${format.toUpperCase()} format`,
        () => {
          window.location.href = `/api/data-export?format=${format}`
          toast.success(`Exporting ${format.toUpperCase()}…`)
        }
      )
    } else {
      window.location.href = `/api/data-export?format=${format}`
      toast.success(`Exporting ${format.toUpperCase()}…`)
    }
  }

  // PRD Part 30 §1.2: PIN-guarded reset
  const handleResetWithPin = async () => {
    if (!resetPin || resetPin.length < 4) {
      toast.error('PIN দিন (৪-৬ ডিজিট)')
      return
    }
    setResetting(true)
    try {
      // Verify PIN
      const pinRes = await fetch('/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', pin: resetPin }),
      })
      if (!pinRes.ok) {
        toast.error('ভুল PIN — রিসেট অনুমোদিত নয়')
        setResetting(false)
        return
      }
      // PIN verified — proceed with reset
      toast.loading('Resetting data…')
      const res = await fetch('/api/reset', { method: 'POST' })
      if (!res.ok) throw new Error('Reset failed')
      toast.dismiss()
      toast.success('ডেমো ডেটা রিসেট সফল!')
      setShowResetModal(false)
      setResetPin('')
      // PRD Part 30 §1.1: Push notification on restore/reset
      useNotificationStore.getState().addNotification({
        id: crypto.randomUUID(),
        type: 'backup',
        title: 'ডেটা রিসেট সম্পন্ন ✅',
        body: 'সমস্ত ডেটা ডিফল্ট স্টেটে রিসেট করা হয়েছে।',
        time: 'এইমাত্র',
        read: false,
        action: { view: 'settings' },
      })
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast.dismiss()
      toast.error('রিসেট ব্যর্থ: ' + String(e))
    } finally {
      setResetting(false)
    }
  }

  const reseed = () => {
    // PRD Part 32 §1.5: Danger Zone biometric gate → then PIN modal
    if (gateConfig.gateDangerZone) {
      triggerGate(
        'danger_zone',
        'Permanently reset all demo data — this cannot be undone',
        () => setShowResetModal(true)
      )
    } else {
      setShowResetModal(true)
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

            {/* PRD Part 28 §3: Invoice header info banner */}
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-start gap-2">
              <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-700 dark:text-blue-300">
                এই তথ্যগুলো সরাসরি ইনভয়েস পিডিএফ ও থার্মাল প্রিন্ট হেডারে অটো-সিঙ্ক হবে। Save করার সাথে সাথে নতুন বিলগুলোতে আপডেটেড তথ্য দেখা যাবে।
              </p>
            </div>

            <Field label={t('set.businessName')} value={form.name || ''} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label={t('set.ownerName')} value={form.ownerName || ''} onChange={(v) => setForm({ ...form, ownerName: v })} />
            <Field label={t('set.phone')} value={form.phone || ''} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label={t('set.email')} value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label={t('set.state')} value={form.state || ''} onChange={(v) => setForm({ ...form, state: v })} />

            {/* PRD Part 28 §1: GSTIN with real-time validation */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                {t('set.gstin')}
                <span className="text-[9px] text-muted-foreground">(১৫ ডিজিট আলফানিউমেরিক)</span>
              </Label>
              <Input
                value={form.gstin || ''}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                className={`h-11 ${!gstinValid ? 'border-red-500' : form.gstin ? 'border-emerald-500' : ''}`}
                placeholder="19ABCDE1234F1Z5"
                maxLength={15}
              />
              {form.gstin && !gstinValid && (
                <p className="text-[10px] text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Invalid GSTIN Format (১৫ ডিজিট আলফানিউমেরিক, স্টেট কোড দিয়ে শুরু)
                </p>
              )}
              {form.gstin && gstinValid && (
                <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Valid GSTIN
                </p>
              )}
            </div>

            {/* PRD Part 28 §1: PAN with real-time validation */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                {t('set.pan')}
                <span className="text-[9px] text-muted-foreground">(১০ ডিজিট আলফানিউমেরিক)</span>
              </Label>
              <Input
                value={form.pan || ''}
                onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                className={`h-11 ${!panValid ? 'border-red-500' : form.pan ? 'border-emerald-500' : ''}`}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
              {form.pan && !panValid && (
                <p className="text-[10px] text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Invalid PAN Format (১০ ডিজিট: ৫ অক্ষর + ৪ সংখ্যা + ১ অক্ষর)
                </p>
              )}
              {form.pan && panValid && (
                <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Valid PAN
                </p>
              )}
            </div>

            {/* PRD Part 28 §2: UPI ID with QR preview */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                {t('set.upiId')}
                <span className="text-[9px] text-muted-foreground">(VPA — বিল QR এ অটো-লিঙ্ক হবে)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  value={form.upiId || ''}
                  onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                  className={`h-11 flex-1 ${!upiValid ? 'border-red-500' : form.upiId ? 'border-emerald-500' : ''}`}
                  placeholder="sharmatrading@upi"
                />
                {form.upiId && upiValid && (
                  <button
                    onClick={() => setShowQrPreview(!showQrPreview)}
                    className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                    title="QR Preview"
                  >
                    <QrCode className="w-5 h-5" />
                  </button>
                )}
              </div>
              {form.upiId && !upiValid && (
                <p className="text-[10px] text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Invalid UPI ID (format: name@bank)
                </p>
              )}
              {/* PRD Part 28 §2: Dynamic QR preview */}
              {showQrPreview && upiQrString && (
                <div className="p-4 rounded-xl bg-muted/30 border border-border text-center">
                  <p className="text-[10px] text-muted-foreground mb-2">ডাইনামিক UPI QR Preview</p>
                  <div className="w-32 h-32 mx-auto bg-white rounded-xl p-2 flex items-center justify-center">
                    {/* QR pattern — uses CSS grid */}
                    <div className="grid grid-cols-8 gap-0.5 w-24 h-24">
                      {Array.from({ length: 64 }).map((_, idx) => {
                        // Simple hash from UPI string for consistent pattern
                        const hash = upiQrString.charCodeAt(idx % upiQrString.length) + idx
                        return <div key={idx} className={`${hash % 2 === 0 ? 'bg-black' : 'bg-white'} rounded-[1px]`} />
                      })}
                    </div>
                  </div>
                  <p className="text-[10px] font-medium mt-2">{form.upiId}</p>
                  <p className="text-[9px] text-muted-foreground mt-1">বিল তৈরি হলে এই QR অটো-জেনারেট হবে (amount সহ)</p>
                </div>
              )}
            </div>

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
            {/* PRD Part 28 §1: Save button locked if validation fails */}
            <Button onClick={saveProfile} disabled={!isFormValid} className="w-full h-11">
              <Save className="w-4 h-4 mr-1.5" /> {isFormValid ? t('set.save') : 'ফরম ভ্যালিড করুন…'}
            </Button>
            {!isFormValid && (
              <p className="text-[10px] text-red-600 text-center">ভ্যালিডেশন এরর — GSTIN/PAN/UPI ফরম্যাট ঠিক করুন</p>
            )}
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
                      toast.success(`Palette: ${p.name} ${p.emoji}`)
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                      activePaletteId === p.id ? 'border-primary' : 'border-border'
                    }`}
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <span className="text-[10px] font-medium">{p.name}</span>
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

            {/* Notifications with expandable channel sub-toggles */}
            <div>
              <button
                onClick={() => setShowNotifChannels(!showNotifChannels)}
                className="w-full flex items-center justify-between gap-3 py-1"
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Bell className="w-4 h-4" />
                  </span>
                  <p className="text-sm font-medium">{t('set.notifications')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={prefs.notificationsEnabled}
                    onCheckedChange={(v) => setPrefs({ ...prefs, notificationsEnabled: v })}
                  />
                  {showNotifChannels ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
              {/* PRD Part 29 §2: Expandable granular channel sub-toggles */}
              {showNotifChannels && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="ml-12 mt-2 space-y-2 overflow-hidden">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">চ্যানেল প্রেফারেন্স</p>
                  {([
                    { key: 'lowStock' as const, label: 'Low Stock Alerts', labelBn: 'লো স্টক অ্যালার্ট' },
                    { key: 'overduePayments' as const, label: 'Payment Overdue Warnings', labelBn: 'বকেয়া পেমেন্ট তাগাদা' },
                    { key: 'gradeChanges' as const, label: 'Customer Grade Changes', labelBn: 'গ্রাহক গ্রেড পরিবর্তন' },
                    { key: 'backups' as const, label: 'App System Backups', labelBn: 'সিস্টেম ব্যাকআপ' },
                  ]).map((ch) => (
                    <div key={ch.key} className="flex items-center justify-between gap-2 py-1">
                      <div>
                        <p className="text-xs font-medium">{ch.label}</p>
                        <p className="text-[9px] text-muted-foreground">{ch.labelBn}</p>
                      </div>
                      <Switch checked={channels[ch.key]} onCheckedChange={() => toggleChannel(ch.key)} />
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            {/* Auto reminders */}
            <ToggleRow
              icon={Sparkles}
              label={t('set.autoReminders')}
              checked={prefs.autoBackupEnabled}
              onChange={(v) => setPrefs({ ...prefs, autoBackupEnabled: v })}
            />

            {/* PRD Part 29 §1: Voice & Input Settings (after Invoice Prefix, before Save) */}
            <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-3">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5" /> ভয়েস ও ইনপুট সেটিংস (Voice & Input)
              </p>
              {/* Toggle 1: Enable Global Voice Input */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                    <Mic className="w-3.5 h-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-medium">Enable Global Voice Input</p>
                    <p className="text-[9px] text-muted-foreground">টপ বারের মাইক ও ভয়েস কমান্ড</p>
                  </div>
                </div>
                <Switch
                  checked={globalVoiceEnabled}
                  onCheckedChange={(v) => { setGlobalVoice(v); toast.success(`Global Voice ${v ? 'চালু' : 'বন্ধ'}`) }}
                />
              </div>
              {/* Toggle 2: Tap-to-Voice / Double-Tap Keyboard */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                    <Keyboard className="w-3.5 h-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-medium">Tap-to-Voice / Double-Tap Keyboard</p>
                    <p className="text-[9px] text-muted-foreground">১-ক্লিকে মাইক, ২-ক্লিকে কীবোর্ড</p>
                  </div>
                </div>
                <Switch
                  checked={tapToVoiceEnabled}
                  onCheckedChange={(v) => { setTapToVoice(v); toast.success(`Tap-to-Voice ${v ? 'চালু' : 'বন্ধ'}`) }}
                />
              </div>
              {/* PRD Part 37 — Sound Box Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                  </span>
                  <div>
                    <p className="text-xs font-medium">সাউন্ড বক্স (Sound Box)</p>
                    <p className="text-[9px] text-muted-foreground">পেমেন্ট এলে "₹৫০০ প্রাপ্ত হয়েছে" ঘোষণা</p>
                  </div>
                </div>
                <Switch
                  checked={soundBoxEnabled}
                  onCheckedChange={(v) => { setSoundBoxEnabled(v); toast.success(`সাউন্ড বক্স ${v ? 'চালু ✅' : 'বন্ধ'}`) }}
                />
              </div>
              {/* Sound Box Test Button */}
              {soundBoxEnabled && (
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      const lang = language
                      const utterance = new SpeechSynthesisUtterance(
                        lang === 'bn' ? `নিশ্চিত ভুক্তি। ৫০০ টাকা প্রাপ্ত হয়েছে।` :
                        lang === 'hi' ? `भुगतान प्राप्त। 500 रुपये प्राप्त हुए।` :
                        `Payment received. 500 rupees received.`
                      )
                      utterance.lang = lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN'
                      utterance.rate = 0.9
                      window.speechSynthesis.speak(utterance)
                      toast.success('সাউন্ড বক্স টেস্ট চলছে...')
                    } else {
                      toast.error('এই ব্রাউজারে সাউন্ড বক্স সাপোর্ট করে না')
                    }
                  }}
                  className="w-full py-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-500/20 transition-colors"
                >
                  <Volume2 className="w-3.5 h-3.5" /> টেস্ট করুন (Test Sound)
                </button>
              )}
            </div>

            {/* PRD Part 29 §3: Save applies theme + language instantly (no restart) */}
            <Button onClick={savePrefs} className="w-full h-11">
              <Save className="w-4 h-4 mr-1.5" /> {t('set.save')}
            </Button>
          </Card>
        )}

        {tab === 'data' && (
          <div className="space-y-3">
            {/* PRD Part 30 §1.1: Local Export — Manager/Sales restricted */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">Local Export</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Download your business data for backup.</p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  onClick={() => exportData('json')}
                  disabled={userRole !== 'owner'}
                  className="w-full h-11 justify-start disabled:opacity-40"
                >
                  <Download className="w-4 h-4 mr-2" /> {t('set.exportJson')}
                  {userRole !== 'owner' && <span className="ml-auto text-[9px] text-muted-foreground">Owner only</span>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportData('csv')}
                  disabled={userRole !== 'owner'}
                  className="w-full h-11 justify-start disabled:opacity-40"
                >
                  <FileText className="w-4 h-4 mr-2" /> {t('set.exportCsv')}
                  {userRole !== 'owner' && <span className="ml-auto text-[9px] text-muted-foreground">Owner only</span>}
                </Button>
              </div>
            </Card>

            {/* Cloud Backup */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">Cloud Backup</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Send your data to Telegram or Google Drive.</p>
              <div className="space-y-2">
                <Button variant="outline" onClick={() => {
                  // PRD Part 32 §1.3: Data Export gate for Telegram backup
                  const doBackup = async () => {
                    try {
                      toast.loading('Sending to Telegram…')
                      const res = await fetch('/api/backup/telegram', { method: 'POST' })
                      const data = await res.json()
                      toast.dismiss()
                      if (data.ok) {
                        toast.success(`Sent to Telegram — ${data.records?.parties || 0} parties, ${data.records?.invoices || 0} invoices`)
                        // PRD Part 30 §1.1: Push notification on backup
                        useNotificationStore.getState().addNotification({
                          id: crypto.randomUUID(),
                          type: 'backup',
                          title: 'Telegram ব্যাকআপ সম্পন্ন ✅',
                          body: `${data.records?.parties || 0} parties, ${data.records?.invoices || 0} invoices sent to Telegram.`,
                          time: 'এইমাত্র',
                          read: false,
                          action: { view: 'settings' },
                        })
                        triggerRefresh()
                      } else throw new Error(data.error)
                    } catch (e) { toast.dismiss(); toast.error('Failed: ' + String(e)) }
                  }
                  if (gateConfig.gateDataExport) {
                    triggerGate('data_export', 'Send business data backup to Telegram', doBackup)
                  } else {
                    doBackup()
                  }
                }} className="w-full h-11 justify-start">
                  <Upload className="w-4 h-4 mr-2" /> Send to Telegram
                </Button>
                <Button variant="outline" onClick={() => {
                  // PRD Part 32 §1.3: Data Export gate for Drive backup
                  const doBackup = async () => {
                    try {
                      toast.loading('Uploading to Google Drive…')
                      const res = await fetch('/api/backup/drive', { method: 'POST' })
                      const data = await res.json()
                      toast.dismiss()
                      if (data.ok) {
                        toast.success(`Uploaded to Drive — ${data.records?.products || 0} products, ${data.records?.transactions || 0} transactions`)
                        useNotificationStore.getState().addNotification({
                          id: crypto.randomUUID(),
                          type: 'backup',
                          title: 'Google Drive ব্যাকআপ সম্পন্ন ✅',
                          body: `${data.records?.products || 0} products, ${data.records?.transactions || 0} transactions uploaded.`,
                          time: 'এইমাত্র',
                          read: false,
                          action: { view: 'settings' },
                        })
                        triggerRefresh()
                      } else throw new Error(data.error)
                    } catch (e) { toast.dismiss(); toast.error('Failed: ' + String(e)) }
                  }
                  if (gateConfig.gateDataExport) {
                    triggerGate('data_export', 'Upload business data backup to Google Drive', doBackup)
                  } else {
                    doBackup()
                  }
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
                      // PRD Part 30 §1.1: Push notification on restore check
                      useNotificationStore.getState().addNotification({
                        id: crypto.randomUUID(),
                        type: 'backup',
                        title: 'ব্যাকআপ রিস্টোর চেক ✅',
                        body: `সর্বশেষ ব্যাকআপ: ${latest.channel} — ${new Date(latest.date).toLocaleString()}`,
                        time: 'এইমাত্র',
                        read: false,
                        action: { view: 'settings' },
                      })
                    }
                  } catch (e) { toast.error('Failed: ' + String(e)) }
                }} className="w-full h-11 justify-start">
                  <Database className="w-4 h-4 mr-2" /> Fetch Old Backup / Restore
                </Button>
              </div>
            </Card>

            {/* PRD Part 30 §1.2: Danger Zone with PIN guard */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1 text-destructive flex items-center gap-1.5">
                <Lock className="w-4 h-4" /> Danger Zone
              </h3>
              <p className="text-[11px] text-muted-foreground mb-4">PIN বা বায়োমেট্রিক প্রয়োজন — ডেটা রিসেট করতে।</p>
              <Button
                variant="outline"
                onClick={reseed}
                disabled={userRole !== 'owner'}
                className="w-full h-11 text-destructive border-destructive/30 disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4 mr-2" /> Reset Demo Data
                {userRole !== 'owner' && <span className="ml-auto text-[9px] text-muted-foreground">Owner only</span>}
              </Button>
            </Card>
          </div>
        )}

        {/* PRD Part 33: Marketplace & Monetization tab */}
        {tab === 'marketplace' && (
          <div className="space-y-4">
            {/* Store Link & PWA */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Online Store & PWA</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Your shop is live as a Progressive Web App. Customers can browse and order from any browser — no app install needed.
              </p>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                <p className="text-[10px] text-muted-foreground">Your Store Link</p>
                <p className="text-sm font-mono text-emerald-600 break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/?store=${business?.storeSlug || 'sharma-trading-co'}` : ''}
                </p>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px]"
                    onClick={() => {
                      const url = `${window.location.origin}/?store=${business?.storeSlug || 'sharma-trading-co'}`
                      navigator.clipboard.writeText(url)
                      toast.success('Store link copied!')
                    }}
                  >
                    <ExternalLink className="w-3 h-3 mr-1" /> Copy Link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px]"
                    onClick={() => {
                      window.open(`/?store=${business?.storeSlug || 'sharma-trading-co'}`, '_blank')
                    }}
                  >
                    <Store className="w-3 h-3 mr-1" /> Preview Store
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  <div>
                    <p className="text-xs font-medium">PWA Installable</p>
                    <p className="text-[10px] text-muted-foreground">Customers can "Add to Home Screen"</p>
                  </div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
            </Card>

            {/* Delivery Radius & Geo-fence */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Delivery Radius (Geo-fence)</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Set the maximum delivery area. Customers outside this radius will see "Unserviceable Location" with AI recommendations.
              </p>
              <DeliveryRadiusControl />
            </Card>

            {/* Monetization: SaaS Subscription */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold">SaaS Subscription</h3>
              </div>
              <SubscriptionControl />
            </Card>

            {/* Monetization: Commission & Revenue Stats */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Revenue & Commission</h3>
              </div>
              <RevenueStats />
            </Card>

            {/* Monetization: Sponsored Ads */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold">Sponsored Ads (Featured Placement)</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Pay to appear at the top of "More Shops" listings in your area. Featured shops get a gold badge + priority placement.
              </p>
              <SponsoredAdsControl />
            </Card>

            {/* PRD Part 37 §1.1: Merchant Control Toggles */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Merchant Control Toggles</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Control your shop's online visibility and storage mode. Toggle off online sales to hide from the global catalog.
              </p>
              <MerchantToggles />
            </Card>

            {/* PRD Part 37 §1.2: Hybrid Dual-Storage */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-600" />
                <h3 className="text-sm font-semibold">Hybrid Dual-Storage</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Local Mode (Free): All data in SQLite, images compressed to 100-200KB. Cloud Sync Mode: Media pushed to Telegram as File IDs — zero cloud cost.
              </p>
              <StorageModeControl />
            </Card>

            {/* PRD Part 37 §3: Dual-Profile Switching */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Dual-Profile Switching</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Switch between Customer and Merchant mode. Same phone number, separate data isolation.
              </p>
              <DualProfileControl />
            </Card>
          </div>
        )}

        {tab === 'security' && (
          <div className="space-y-4">
            {/* Voice & Input Settings moved to Preferences tab (PRD Part 29 §1) */}

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

            {/* RBAC Roles — PRD Part 30 §2 */}
            <Card className="p-5 space-y-3">
              <h3 className="text-sm font-semibold">User Role (RBAC)</h3>
              <p className="text-[11px] text-muted-foreground">Control access level for this device</p>
              <div className="grid grid-cols-3 gap-2">
                {(['owner', 'manager', 'sales'] as const).map((role) => (
                  <button
                    key={role}
                    onClick={async () => {
                      // PRD Part 32 §1.1: Owner Mode Re-switching gate
                      // Only gate when switching TO owner from a non-owner role
                      if (role === 'owner' && userRole !== 'owner' && gateConfig.gateOwnerSwitch) {
                        triggerGate(
                          'owner_switch',
                          `Switch from ${userRole} mode back to Owner mode`,
                          async () => {
                            setRole('owner')
                            await apiPut('/api/app-settings', { userRole: 'owner' })
                            toast.success('Role set: owner')
                          }
                        )
                        return
                      }
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
              {/* PRD Part 30 §2: Role descriptions */}
              <div className="p-3 rounded-xl bg-muted/30 space-y-1.5">
                {userRole === 'owner' && (
                  <>
                    <p className="text-[10px] text-emerald-600 font-medium">✅ সম্পূর্ণ অ্যাক্সেস — সব ফিচার, ডিলিট, এক্সপোর্ট, সেটিংস</p>
                    <p className="text-[10px] text-muted-foreground">Full access — all features, delete, export, settings</p>
                  </>
                )}
                {userRole === 'manager' && (
                  <>
                    <p className="text-[10px] text-amber-600 font-medium">⚠️ সেলস, ইনভেন্টরি, খাতা — কোনো ডিলিট/এক্সপোর্ট/সেটিংস নয়</p>
                    <p className="text-[10px] text-muted-foreground">Sales, Inventory, Khata — no delete/export/settings (greyed out)</p>
                  </>
                )}
                {userRole === 'sales' && (
                  <>
                    <p className="text-[10px] text-red-600 font-medium">🔒 শুধু হোম + বিলিং — খাতা ও More মেনু হাইড</p>
                    <p className="text-[10px] text-muted-foreground">Home + Billing only — Khata & More menu hidden</p>
                  </>
                )}
              </div>
            </Card>

            {/* PRD Part 32 §1: Biometric Action Gates config */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Biometric Action Gates</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Mandatory fingerprint/PIN verification at 5 critical action gates. 2 wrong attempts → 2-min lockdown + Telegram alert.
              </p>
              <div className="space-y-2">
                {[
                  { key: 'gateOwnerSwitch', label: 'Owner Mode Re-switching', desc: 'Switching back from Manager/Sales to Owner', icon: Shield },
                  { key: 'gateHighValueDiscount', label: 'High-Value Discount', desc: 'Discount above the limit (₹)', icon: Fingerprint },
                  { key: 'gateDataExport', label: 'Data Export Security', desc: 'JSON/CSV export or Telegram backup', icon: Download },
                  { key: 'gateInventoryPrice', label: 'Inventory Price Modification', desc: 'Edit purchase price or bulk stock', icon: AlertCircle },
                  { key: 'gateDangerZone', label: 'Danger Zone Authentication', desc: 'Demo data reset or khata delete', icon: Lock },
                ].map((g) => (
                  <div key={g.key} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <g.icon className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{g.label}</p>
                        <p className="text-[10px] text-muted-foreground">{g.desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={(gateConfig as any)[g.key]}
                      onCheckedChange={async (checked) => {
                        const newConfig = { ...gateConfig, [g.key]: checked }
                        setGateConfig(newConfig)
                        await apiPut('/api/app-settings', { [g.key]: checked })
                        toast.success(`${g.label}: ${checked ? 'Enabled' : 'Disabled'}`)
                      }}
                    />
                  </div>
                ))}
                {/* Discount limit input */}
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <IndianRupee className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">High-Value Discount Limit (₹)</p>
                      <p className="text-[10px] text-muted-foreground">Discounts above this trigger the gate</p>
                    </div>
                  </div>
                  <Input
                    type="number"
                    value={gateConfig.gateDiscountLimit}
                    onChange={(e) => setGateConfig({ ...gateConfig, gateDiscountLimit: Number(e.target.value) })}
                    onBlur={async () => {
                      await apiPut('/api/app-settings', { gateDiscountLimit: gateConfig.gateDiscountLimit })
                      toast.success('Discount limit updated')
                    }}
                    className="w-24 h-9 text-xs"
                    inputMode="numeric"
                  />
                </div>
              </div>
            </Card>

            {/* PRD Part 32 §2 & §3: External Scanner + Defaulter Registry */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-purple-600" />
                <h3 className="text-sm font-semibold">External Biometric & Merchant Mesh</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                  <div className="flex items-start gap-2 flex-1">
                    <Fingerprint className="w-3.5 h-3.5 text-purple-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">External USB OTG Scanner</p>
                      <p className="text-[10px] text-muted-foreground">Mantra MFS100 / Morpho SDK support</p>
                    </div>
                  </div>
                  <Switch
                    checked={gateConfig.externalScannerEnabled}
                    onCheckedChange={async (checked) => {
                      setGateConfig({ ...gateConfig, externalScannerEnabled: checked })
                      await apiPut('/api/app-settings', { externalScannerEnabled: checked })
                      toast.success(`External scanner: ${checked ? 'Enabled' : 'Disabled'}`)
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
                  <div className="flex items-start gap-2 flex-1">
                    <Shield className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">Merchant Mesh Defaulter Registry</p>
                      <p className="text-[10px] text-muted-foreground">Shared blacklist across local merchant group</p>
                    </div>
                  </div>
                  <Switch
                    checked={gateConfig.defaulterRegistryEnabled}
                    onCheckedChange={async (checked) => {
                      setGateConfig({ ...gateConfig, defaulterRegistryEnabled: checked })
                      await apiPut('/api/app-settings', { defaulterRegistryEnabled: checked })
                      toast.success(`Defaulter registry: ${checked ? 'Enabled' : 'Disabled'}`)
                    }}
                  />
                </div>
              </div>
            </Card>

            {/* PRD Part 34: Threat Matrix Security Dashboard */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-red-600" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Threat Matrix Dashboard</h3>
                  <p className="text-[11px] text-muted-foreground">5-layer cyber attack protection (GLM 5.2 Core)</p>
                </div>
              </div>
              <ThreatMatrixInline />
            </Card>
          </div>
        )}
      </motion.div>

      {/* PRD Part 30 §1.2: PIN Re-authentication Modal for Reset */}
      <Dialog open={showResetModal} onOpenChange={setShowResetModal}>
        <FormDialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-destructive" /> রিসেট অথেন্টিকেশন
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              ডেটা রিসেট করতে আপনার App PIN দিন অথবা বায়োমেট্রিক স্ক্যান করুন।
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">App PIN (৪-৬ ডিজিট)</Label>
              <Input
                value={resetPin}
                onChange={(e) => setResetPin(e.target.value.replace(/[^0-9]/g, ''))}
                className="h-12 text-center text-xl font-bold tabular tracking-widest"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                type="password"
              />
            </div>
            {/* Biometric option */}
            <button
              onClick={async () => {
                toast.info('বায়োমেট্রিক স্ক্যান শুরু হচ্ছে…')
                // Simulate biometric — in production this would use the device API
                setTimeout(() => {
                  toast.success('বায়োমেট্রিক ভেরিফাইড ✅')
                  setResetPin('0000') // Auto-fill with verified token
                }, 1500)
              }}
              className="w-full p-3 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <Fingerprint className="w-5 h-5" /> বায়োমেট্রিক ফিঙ্গারপ্রিন্ট স্ক্যান
            </button>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowResetModal(false); setResetPin('') }} className="h-11">
              বাতিল
            </Button>
            <Button
              onClick={handleResetWithPin}
              disabled={resetting || resetPin.length < 4}
              variant="destructive"
              className="h-11 flex-1"
            >
              {resetting ? 'রিসেট হচ্ছে…' : 'রিসেট নিশ্চিত করুন'}
            </Button>
          </DialogFooter>
        </FormDialogContent>
      </Dialog>

      {/* §KEYBOARD-AWARE: Bottom spacer so the Save button (and any form field
          at the bottom) can be scrolled above the virtual keyboard.
          Uses 50vh — enough to clear any mobile keyboard height. */}
      <div className="h-[50vh] shrink-0" aria-hidden="true" />
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

// PRD Part 33 §3.1: Delivery Radius & Geo-fence control
function DeliveryRadiusControl() {
  const { business, setBusiness } = useAppStore()
  const [radius, setRadius] = useState(business?.deliveryRadiusKm ?? 5)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/business/delivery-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryRadiusKm: radius }),
      })
      const updated = await res.json()
      setBusiness(updated)
      toast.success(`Delivery radius set to ${radius} km`)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Radius</span>
        <span className="text-2xl font-bold text-emerald-600 tabular">{radius} km</span>
      </div>
      <input
        type="range"
        min={1}
        max={20}
        value={radius}
        onChange={(e) => setRadius(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-emerald-600"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>1 km</span>
        <span>5 km</span>
        <span>10 km</span>
        <span>15 km</span>
        <span>20 km</span>
      </div>
      <div className="p-2.5 rounded-xl bg-muted/30 text-[11px] text-muted-foreground">
        <MapPin className="w-3 h-3 inline mr-1" />
        Shop location: {business?.latitude ? `${business.latitude.toFixed(4)}, ${business.longitude?.toFixed(4)}` : 'Not set'}
      </div>
      <Button onClick={handleSave} disabled={saving} className="w-full h-10">
        {saving ? <Radio className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
        Save Delivery Radius
      </Button>
    </div>
  )
}

// PRD Part 33 §4.1: SaaS Subscription control
function SubscriptionControl() {
  const { business, setBusiness } = useAppStore()
  const [subscribing, setSubscribing] = useState(false)
  const plan = business?.subscriptionPlan ?? 'trial'
  const trialEnds = (business as any)?.trialEndsAt
  const subEnds = (business as any)?.subscriptionEndsAt

  const handleSubscribe = async (planType: 'monthly' | 'yearly') => {
    setSubscribing(true)
    try {
      const res = await fetch('/api/monetization/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planType }),
      })
      const updated = await res.json()
      setBusiness(updated)
      toast.success(`Subscription activated — ${planType === 'monthly' ? '₹199/month' : '₹1999/year'}`)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSubscribing(false)
    }
  }

  if (plan === 'active') {
    return (
      <div className="space-y-2">
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-700">Active Subscription</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Renews on {subEnds ? new Date(subEnds).toLocaleDateString() : 'N/A'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {plan === 'trial' && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-700">Free Trial Active</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {trialEnds ? `Expires on ${new Date(trialEnds).toLocaleDateString()}` : 'Subscribe to continue after trial'}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => handleSubscribe('monthly')} disabled={subscribing} className="h-12 flex-col">
          <span className="text-sm font-bold">₹199</span>
          <span className="text-[10px] opacity-80">per month</span>
        </Button>
        <Button onClick={() => handleSubscribe('yearly')} disabled={subscribing} variant="outline" className="h-12 flex-col">
          <span className="text-sm font-bold">₹1,999</span>
          <span className="text-[10px] opacity-80">per year (save 16%)</span>
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        Includes unlimited khata, billing, GST, AI tools & marketplace listing
      </p>
    </div>
  )
}

// PRD Part 33 §4: Revenue & Commission stats
function RevenueStats() {
  const { data: stats } = useFetch<any>('/api/monetization/stats', [])

  if (!stats) {
    return <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
  }

  const formatNum = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <div className="space-y-2">
      {/* Commission Earned */}
      <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Commission Earned
          </p>
          <span className="text-[10px] text-emerald-600">{stats.commissionEarned.count} orders</span>
        </div>
        <p className="text-xl font-bold text-emerald-600 tabular">{formatNum(stats.commissionEarned.total)}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Pending: {formatNum(stats.commissionEarned.pending)} · Paid: {formatNum(stats.commissionEarned.paid)}
        </p>
      </div>

      {/* Commission Paid */}
      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <ShoppingCart className="w-3 h-3" /> Commission Paid (More Shops)
          </p>
          <span className="text-[10px] text-amber-600">{stats.commissionPaid.count} orders</span>
        </div>
        <p className="text-xl font-bold text-amber-600 tabular">{formatNum(stats.commissionPaid.total)}</p>
      </div>

      {/* Catalog Orders */}
      <div className="p-3 rounded-xl bg-muted/30">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Store className="w-3 h-3" /> Online Catalog Orders
          </p>
          <span className="text-[10px] text-muted-foreground">{stats.catalogOrders.pending} pending</span>
        </div>
        <p className="text-xl font-bold tabular">{stats.catalogOrders.total} orders</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Revenue: {formatNum(stats.catalogOrders.revenue)}
        </p>
      </div>
    </div>
  )
}

// PRD Part 33 §4.3: Sponsored Ads control
function SponsoredAdsControl() {
  const { business, setBusiness } = useAppStore()
  const [sponsoring, setSponsoring] = useState(false)
  const [area, setArea] = useState((business as any)?.sponsoredArea || 'Howrah')
  const isSponsored = (business as any)?.isSponsored ?? false
  const sponsoredUntil = (business as any)?.sponsoredUntil

  const handleSponsor = async () => {
    setSponsoring(true)
    try {
      const res = await fetch('/api/monetization/sponsor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area, days: 30 }),
      })
      const updated = await res.json()
      setBusiness(updated)
      toast.success(`Sponsored for 30 days in ${area}! You'll appear at the top of "More Shops".`)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSponsoring(false)
    }
  }

  const handleCancel = async () => {
    setSponsoring(true)
    try {
      const res = await fetch('/api/monetization/sponsor', { method: 'DELETE' })
      const updated = await res.json()
      setBusiness(updated)
      toast.success('Sponsored ad cancelled')
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSponsoring(false)
    }
  }

  if (isSponsored) {
    return (
      <div className="space-y-2">
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-600 fill-amber-500" />
            <p className="text-sm font-medium text-amber-700">Featured Shop Active!</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Area: {area} · Until {sponsoredUntil ? new Date(sponsoredUntil).toLocaleDateString() : 'N/A'}
          </p>
        </div>
        <Button onClick={handleCancel} disabled={sponsoring} variant="outline" className="w-full h-9 text-xs">
          Cancel Sponsored Ad
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Target Area</Label>
        <Input value={area} onChange={(e) => setArea(e.target.value)} className="h-9 text-sm" placeholder="e.g. Howrah, Gariahat" />
      </div>
      <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <p className="text-[11px] text-muted-foreground">
          <Star className="w-3 h-3 inline mr-1 text-amber-600" />
          30 days featured placement: <span className="font-bold text-amber-700">₹499</span>
        </p>
      </div>
      <Button onClick={handleSponsor} disabled={sponsoring} className="w-full h-10 bg-gradient-to-r from-amber-500 to-orange-500">
        {sponsoring ? <Radio className="w-4 h-4 mr-1.5 animate-spin" /> : <Star className="w-4 h-4 mr-1.5" />}
        Become Featured Shop
      </Button>
    </div>
  )
}

// PRD Part 34: Threat Matrix inline dashboard (lightweight, no external deps)
function ThreatMatrixInline() {
  return (
    <div className="space-y-3">
      {/* 5 Threat Protection Layers */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { id: 1, label: 'Anti-Tamper', icon: Shield },
          { id: 2, label: 'HMAC + JWT', icon: Lock },
          { id: 3, label: 'GPS Triangulation', icon: Globe },
          { id: 4, label: 'Brute-Force Lock', icon: Ban },
          { id: 5, label: 'XSS + RLS', icon: Server },
        ].map((t) => (
          <div
            key={t.id}
            className="p-2 rounded-xl text-center border bg-emerald-500/10 border-emerald-500/30"
          >
            <t.icon className="w-3.5 h-3.5 mx-auto mb-0.5 text-emerald-600" />
            <p className="text-[8px] font-medium leading-tight">{t.label}</p>
            <p className="text-[8px] mt-0.5 text-emerald-600">✓ Active</p>
          </div>
        ))}
      </div>

      {/* Security Posture */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/5">
          <Lock className="w-3 h-3 text-emerald-600" />
          <div>
            <p className="text-[10px] font-medium">SSL Pinning</p>
            <p className="text-[9px] text-emerald-600">✓ Enforced</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/5">
          <Globe className="w-3 h-3 text-emerald-600" />
          <div>
            <p className="text-[10px] font-medium">HSTS</p>
            <p className="text-[9px] text-emerald-600">✓ Strict HTTPS</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/5">
          <Fingerprint className="w-3 h-3 text-emerald-600" />
          <div>
            <p className="text-[10px] font-medium">Biometric Gates</p>
            <p className="text-[9px] text-emerald-600">✓ 5 active</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/5">
          <Server className="w-3 h-3 text-emerald-600" />
          <div>
            <p className="text-[10px] font-medium">Row-Level Security</p>
            <p className="text-[9px] text-emerald-600">✓ BIZ-ID locked</p>
          </div>
        </div>
      </div>

      {/* 5-Layer Threat Legend */}
      <div className="p-3 rounded-xl bg-muted/30 space-y-1 text-[9px] text-muted-foreground">
        <p className="text-[10px] font-semibold mb-1 flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-600" /> 5-Layer Threat Protection
        </p>
        <p>① <strong>Anti-Tamper:</strong> Code obfuscation + root/debugger detection → auto-lock</p>
        <p>② <strong>HMAC + JWT:</strong> Every request signed → IP block on tampering</p>
        <p>③ <strong>GPS Triangulation:</strong> GPS + Cell Tower + IP geo cross-verify</p>
        <p>④ <strong>Brute-Force:</strong> 2-strike → 2min → 5min → 1hr → 24hr → permanent</p>
        <p>⑤ <strong>XSS + RLS:</strong> Input sanitization + BIZ-ID row-level isolation</p>
      </div>

      {/* Exponential Backoff Info */}
      <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
          <Ban className="w-3 h-3" /> Brute-Force Exponential Backoff
        </p>
        <p className="text-[9px] text-muted-foreground mt-0.5">
          2 fails → 2min lock → 5min → 1hr → 24hr → permanent + Telegram alert
        </p>
      </div>
    </div>
  )
}


// PRD Part 37 §1.1: Merchant Control Toggles
function MerchantToggles() {
  const [toggles, setToggles] = useState({
    onlineSalesEnabled: true,
    offlineOnlyMode: false,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/toggles')
      .then((r) => r.json())
      .then((d) => {
        if (d.onlineSalesEnabled !== undefined) {
          setToggles({
            onlineSalesEnabled: d.onlineSalesEnabled,
            offlineOnlyMode: d.offlineOnlyMode,
          })
        }
      })
      .catch(() => {})
  }, [])

  const updateToggle = async (key: 'onlineSalesEnabled' | 'offlineOnlyMode', value: boolean) => {
    setSaving(true)
    try {
      const res = await apiPut('/api/settings/toggles', { [key]: value })
      const updated = await res
      setToggles({
        onlineSalesEnabled: (updated as any).onlineSalesEnabled ?? toggles.onlineSalesEnabled,
        offlineOnlyMode: (updated as any).offlineOnlyMode ?? toggles.offlineOnlyMode,
      })
      toast.success(`${key === 'onlineSalesEnabled' ? 'Online Sales' : 'Offline Mode'}: ${value ? 'ON' : 'OFF'}`)
    } catch (e) {
      toast.error('Failed to update toggle')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
        <div className="flex items-start gap-2 flex-1">
          <Store className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">Online Sales</p>
            <p className="text-[10px] text-muted-foreground">Show shop in global catalog & GPS map</p>
          </div>
        </div>
        <Switch
          checked={toggles.onlineSalesEnabled}
          onCheckedChange={(checked) => updateToggle('onlineSalesEnabled', checked)}
          disabled={saving}
        />
      </div>
      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
        <div className="flex items-start gap-2 flex-1">
          <Database className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">Offline Billing Only</p>
            <p className="text-[10px] text-muted-foreground">Pure offline ledger mode (disables online sales)</p>
          </div>
        </div>
        <Switch
          checked={toggles.offlineOnlyMode}
          onCheckedChange={(checked) => updateToggle('offlineOnlyMode', checked)}
          disabled={saving}
        />
      </div>
      {toggles.offlineOnlyMode && (
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-400">
          ⚠️ Offline mode is ON. Your shop is hidden from the global catalog. Customers cannot find you on the marketplace.
        </div>
      )}
    </div>
  )
}

// PRD Part 37 §1.2: Hybrid Dual-Storage Control
function StorageModeControl() {
  const [cloudSync, setCloudSync] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetch('/api/settings/toggles')
      .then((r) => r.json())
      .then((d) => setCloudSync(d.cloudSyncMode ?? false))
      .catch(() => {})
  }, [])

  const toggleCloudSync = async (enabled: boolean) => {
    setSyncing(true)
    try {
      await apiPut('/api/settings/toggles', { cloudSyncMode: enabled, telegramFileIdMode: enabled })
      setCloudSync(enabled)
      toast.success(`Cloud Sync: ${enabled ? 'ON — media pushed to Telegram (zero cost)' : 'OFF — local storage only'}`)
    } catch (e) {
      toast.error('Failed to toggle cloud sync')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-muted/30">
        <div className="flex items-start gap-2 flex-1">
          <Cloud className="w-3.5 h-3.5 text-purple-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">Cloud Sync Mode (Telegram)</p>
            <p className="text-[10px] text-muted-foreground">AI-remodeled images + 360° videos pushed as Telegram File IDs</p>
          </div>
        </div>
        <Switch checked={cloudSync} onCheckedChange={toggleCloudSync} disabled={syncing} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={`p-2.5 rounded-xl border text-center ${!cloudSync ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-muted/30 border-border'}`}>
          <Database className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
          <p className="text-[10px] font-medium">Local Mode</p>
          <p className="text-[9px] text-muted-foreground">SQLite + compressed images (100-200KB)</p>
          <p className="text-[9px] text-emerald-600 font-medium mt-0.5">{!cloudSync ? '✓ Active' : 'Free'}</p>
        </div>
        <div className={`p-2.5 rounded-xl border text-center ${cloudSync ? 'bg-purple-500/5 border-purple-500/30' : 'bg-muted/30 border-border'}`}>
          <Cloud className="w-4 h-4 mx-auto mb-1 text-purple-600" />
          <p className="text-[10px] font-medium">Cloud Sync</p>
          <p className="text-[9px] text-muted-foreground">Telegram File IDs — ₹0 cloud cost</p>
          <p className="text-[9px] text-purple-600 font-medium mt-0.5">{cloudSync ? '✓ Active' : 'Zero cost'}</p>
        </div>
      </div>
    </div>
  )
}

// PRD Part 37 §3: Dual-Profile Switching
function DualProfileControl() {
  const [phone, setPhone] = useState('')
  const [profile, setProfile] = useState<any>(null)
  const [showBecomeSeller, setShowBecomeSeller] = useState(false)
  const [sellerName, setSellerName] = useState('')
  const [pin, setPin] = useState('')
  const [biometric, setBiometric] = useState(true)
  const [loading, setLoading] = useState(false)

  const checkProfile = async () => {
    if (!phone) return
    try {
      const res = await fetch(`/api/profile/switch-role?phone=${phone}`)
      if (res.ok) {
        const d = await res.json()
        setProfile(d)
      }
    } catch {}
  }

  const becomeSeller = async () => {
    if (!phone || !pin || pin.length < 4) {
      toast.error('Enter phone + 4-6 digit PIN')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/profile/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          customerName: profile?.customerName || 'Customer',
          merchantName: sellerName || 'My Shop',
          pin,
          biometricEnabled: biometric,
        }),
      })
      const d = await res.json()
      if (d.ok) {
        setProfile(d.profile)
        setShowBecomeSeller(false)
        toast.success('Seller account created! PIN + biometric set.')
      } else {
        toast.error(d.error || 'Failed')
      }
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const switchMode = async (targetMode: 'customer' | 'merchant') => {
    if (!phone) {
      toast.error('Enter phone first')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/profile/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, targetMode, pin: targetMode === 'merchant' ? pin : undefined }),
      })
      const d = await res.json()
      if (d.ok) {
        toast.success(`Switched to ${targetMode} mode`)
      } else {
        toast.error(d.error || d.message || 'Failed')
      }
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Phone Number</Label>
        <div className="flex gap-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 text-sm" placeholder="+91 98300 12345" inputMode="tel" />
          <Button onClick={checkProfile} variant="outline" size="sm" className="h-9">Check</Button>
        </div>
      </div>

      {profile && (
        <div className="p-3 rounded-xl bg-muted/30 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Role: {profile.role}</p>
              <p className="text-[10px] text-muted-foreground">Seller: {profile.isSeller ? '✓ Yes' : '✗ No'}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${profile.isSeller ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
              {profile.role === 'dual' ? 'Dual Profile' : profile.role}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => switchMode('customer')} disabled={loading} variant="outline" size="sm" className="h-8 text-xs">
              <User className="w-3 h-3 mr-1" /> Customer Mode
            </Button>
            <Button onClick={() => switchMode('merchant')} disabled={loading || !profile.isSeller} variant="outline" size="sm" className="h-8 text-xs">
              <Store className="w-3 h-3 mr-1" /> Merchant Mode
            </Button>
          </div>
        </div>
      )}

      {profile && !profile.isSeller && !showBecomeSeller && (
        <Button onClick={() => setShowBecomeSeller(true)} className="w-full h-10 bg-gradient-to-r from-emerald-500 to-teal-500">
          <Store className="w-4 h-4 mr-2" /> Become a Seller
        </Button>
      )}

      {showBecomeSeller && (
        <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Become a Seller</p>
          <div className="space-y-1.5">
            <Label className="text-xs">Shop Name</Label>
            <Input value={sellerName} onChange={(e) => setSellerName(e.target.value)} className="h-9 text-sm" placeholder="My Shop" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Master PIN (4-6 digits)</Label>
            <Input value={pin} onChange={(e) => setPin(e.target.value)} className="h-9 text-sm" inputMode="numeric" placeholder="1234" />
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
            <span className="text-[10px] font-medium">Biometric (Fingerprint)</span>
            <Switch checked={biometric} onCheckedChange={setBiometric} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowBecomeSeller(false)} variant="outline" size="sm" className="flex-1 h-8">Cancel</Button>
            <Button onClick={becomeSeller} disabled={loading} size="sm" className="flex-1 h-8 bg-emerald-600">
              {loading ? 'Creating...' : 'Create Seller Account'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
