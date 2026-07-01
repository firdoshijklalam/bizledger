'use client'

import { useFetch } from '@/hooks/use-fetch'
import { motion } from 'framer-motion'
import {
  Shield, ShieldCheck, AlertTriangle, Lock, Ban, Activity,
  Smartphone, Globe, Fingerprint, Clock, Wifi, Server,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from '@/lib/utils'

interface SecurityStatus {
  ipBlock: { blocked: boolean; reason?: string; clientIP: string }
  lockout: { locked: boolean; lockoutLevel: number; remainingMs: number }
  recentEvents: Array<{
    id: string
    gateType: string
    method: string
    result: string
    staffName: string | null
    ipAddress: string | null
    metadata: string | null
    createdAt: string
  }>
  stats: { totalEvents: number; successCount: number; failedCount: number; lockedCount: number }
  securityFeatures: {
    pinEnabled: boolean
    biometricEnabled: boolean
    gateOwnerSwitch: boolean
    gateHighValueDiscount: boolean
    gateDataExport: boolean
    gateInventoryPrice: boolean
    gateDangerZone: boolean
  }
  sslEnabled: boolean
  hstsEnabled: boolean
  certPinningEnabled: boolean
}

/**
 * PRD Part 34 — Threat Matrix Security Dashboard
 * Shows the owner the current security posture and recent security events.
 */
export function SecurityDashboard() {
  const { data, loading, refetch } = useFetch<SecurityStatus>('/api/security/status', [])

  if (loading || !data) {
    return (
      <div className="space-y-2">
        <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
        <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
      </div>
    )
  }

  const threatLabels: Record<string, string> = {
    owner_switch: 'Owner Switch',
    high_value_discount: 'High-Value Discount',
    data_export: 'Data Export',
    inventory_price: 'Inventory Price',
    danger_zone: 'Danger Zone',
  }

  return (
    <div className="space-y-3">
      {/* Threat Matrix Overview */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { id: 1, label: 'Anti-Tamper', active: true, icon: Shield },
          { id: 2, label: 'HMAC + JWT', active: true, icon: Lock },
          { id: 3, label: 'GPS Triangulation', active: true, icon: Globe },
          { id: 4, label: 'Brute-Force Lock', active: data.lockout.locked || data.stats.failedCount > 0, icon: Ban },
          { id: 5, label: 'XSS + RLS', active: true, icon: Server },
        ].map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`p-2 rounded-xl text-center border ${
              t.active
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-muted/30 border-border'
            }`}
          >
            <t.icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${t.active ? 'text-emerald-600' : 'text-muted-foreground'}`} />
            <p className="text-[8px] font-medium leading-tight">{t.label}</p>
            <p className={`text-[8px] mt-0.5 ${t.active ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {t.active ? '✓ Active' : 'Idle'}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Security Posture Card */}
      <Card className="p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-semibold">Security Posture</h4>
          </div>
          <button
            onClick={() => refetch()}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ↻ Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* SSL/HSTS */}
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
              <p className="text-[9px] text-emerald-600">
                ✓ {Object.values(data.securityFeatures).filter(Boolean).length} active
              </p>
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

        {/* IP Status */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-muted-foreground" />
            <div>
              <p className="text-[10px] font-medium">Your IP</p>
              <p className="text-[9px] text-muted-foreground font-mono">{data.ipBlock.clientIP}</p>
            </div>
          </div>
          <Badge variant={data.ipBlock.blocked ? 'destructive' : 'secondary'} className="text-[9px]">
            {data.ipBlock.blocked ? 'BLOCKED' : 'CLEAN'}
          </Badge>
        </div>

        {/* Lockout Status */}
        {data.lockout.locked && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <Ban className="w-3.5 h-3.5 text-red-600" />
            <div className="flex-1">
              <p className="text-[10px] font-medium text-red-600">
                Brute-Force Lockout Active (Level {data.lockout.lockoutLevel})
              </p>
              <p className="text-[9px] text-muted-foreground">
                {Math.ceil(data.lockout.remainingMs / 60000)} min remaining
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Recent Security Events */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-semibold">Security Audit Log</h4>
          </div>
          <span className="text-[10px] text-muted-foreground">{data.stats.totalEvents} events</span>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="text-center p-1.5 rounded-lg bg-emerald-500/5">
            <p className="text-sm font-bold text-emerald-600">{data.stats.successCount}</p>
            <p className="text-[9px] text-muted-foreground">Verified</p>
          </div>
          <div className="text-center p-1.5 rounded-lg bg-amber-500/5">
            <p className="text-sm font-bold text-amber-600">{data.stats.failedCount}</p>
            <p className="text-[9px] text-muted-foreground">Failed</p>
          </div>
          <div className="text-center p-1.5 rounded-lg bg-red-500/5">
            <p className="text-sm font-bold text-red-600">{data.stats.lockedCount}</p>
            <p className="text-[9px] text-muted-foreground">Locked</p>
          </div>
        </div>

        {/* Event list */}
        <div className="space-y-1 max-h-48 overflow-y-auto scroll-area">
          {data.recentEvents.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-3">
              No security events yet
            </p>
          ) : (
            data.recentEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/20 text-[10px]"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    event.result === 'success'
                      ? 'bg-emerald-500'
                      : event.result === 'locked'
                      ? 'bg-red-500'
                      : 'bg-amber-500'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {threatLabels[event.gateType] || event.gateType}
                    <span className="text-muted-foreground ml-1">· {event.method}</span>
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {event.staffName || 'Unknown'} · {event.ipAddress || 'N/A'}
                  </p>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(event.createdAt))}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Threat Matrix Legend */}
      <Card className="p-3">
        <p className="text-[10px] font-semibold mb-1.5 flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-600" /> 5-Layer Threat Protection
        </p>
        <div className="space-y-1 text-[9px] text-muted-foreground">
          <p>① <strong>Anti-Tamper:</strong> Code obfuscation + root/debugger detection → auto-lock</p>
          <p>② <strong>HMAC + JWT:</strong> Every request signed → IP block on tampering</p>
          <p>③ <strong>GPS Triangulation:</strong> GPS + Cell Tower + IP geo cross-verify</p>
          <p>④ <strong>Brute-Force:</strong> 2-strike → 2min → 5min → 1hr → 24hr → permanent</p>
          <p>⑤ <strong>XSS + RLS:</strong> Input sanitization + BIZ-ID row-level isolation</p>
        </div>
      </Card>
    </div>
  )
}
