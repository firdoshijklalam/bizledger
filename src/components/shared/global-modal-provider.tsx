'use client'

/**
 * §GLOBAL-MODALS: GlobalModalProvider
 *
 * Renders Family, Partner, and Fingerprint modals at the APP ROOT level
 * (inside app-shell, NOT inside any overlay or nested route).
 *
 * §WHY: When these modals were rendered inside party-detail.tsx (which is
 * inside the party overlay z-80), they could get trapped in a lower
 * stacking context when the user navigated Dashboard → Invoice → Profile.
 * The client reported "buttons fail, modals opening in background."
 *
 * §FIX: Per the client's instruction:
 *   1. Stop relying on local state — use global Zustand store.
 *   2. Move modal components OUT of the CustomerProfile screen.
 *   3. Place them at the absolute ROOT of the app.
 *   4. Trigger them using global state: openFamilyModal(partyId, partyName).
 *
 * All three modals use Radix Dialog (which portals to document.body with
 * z-[200]), so they ALWAYS render on top of ALL overlays regardless of
 * how deep the user navigated.
 */

import { useAppStore } from '@/store/app-store'
import { FamilyMemberManager } from '@/components/shared/family-member-manager'
import { PartnerAgentManager } from '@/components/shared/partner-agent-manager'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useState } from 'react'
import { Fingerprint, ShieldAlert } from 'lucide-react'
import { motion } from 'framer-motion'
import { apiPost } from '@/hooks/use-fetch'

export function GlobalModalProvider() {
  const {
    globalFamilyModal, closeFamilyModal,
    globalPartnerModal, closePartnerModal,
    globalFingerprintModal, closeFingerprintModal,
  } = useAppStore()

  return (
    <>
      {/* §FAMILY-MODAL: Rendered at app root. Triggered by openFamilyModal(). */}
      {globalFamilyModal && (
        <FamilyMemberManager
          partyId={globalFamilyModal.partyId}
          partyName={globalFamilyModal.partyName}
          open={true}
          onOpenChange={(o) => { if (!o) closeFamilyModal() }}
        />
      )}

      {/* §PARTNER-MODAL: Rendered at app root. Triggered by openPartnerModal(). */}
      {globalPartnerModal && (
        <PartnerAgentManager
          partyId={globalPartnerModal.partyId}
          partyName={globalPartnerModal.partyName}
          open={true}
          onOpenChange={(o) => { if (!o) closePartnerModal() }}
        />
      )}

      {/* §FINGERPRINT-MODAL: Rendered at app root. Triggered by openFingerprintModal(). */}
      {globalFingerprintModal && (
        <GlobalFingerprintRegisterDialog
          open={true}
          onOpenChange={(o) => { if (!o) closeFingerprintModal() }}
          partyId={globalFingerprintModal.partyId}
          partyName={globalFingerprintModal.partyName}
        />
      )}
    </>
  )
}

/**
 * §FINGERPRINT-MODAL: Global version of FingerprintRegisterDialog.
 * Moved here from party-detail.tsx so it renders at app root.
 * Uses the same logic: POST /api/fingerprints with role: 'primary'.
 */
function GlobalFingerprintRegisterDialog({
  open, onOpenChange, partyId, partyName,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId: string
  partyName: string
}) {
  const [scanning, setScanning] = useState(false)
  const [hand, setHand] = useState('right')
  const [finger, setFinger] = useState('thumb')
  const [scannerType, setScannerType] = useState<'native' | 'external'>('native')

  const handleScan = async () => {
    setScanning(true)
    await new Promise((r) => setTimeout(r, 1400))
    try {
      await apiPost('/api/fingerprints', {
        partyId,
        role: 'primary',
        hand,
        finger,
        scannerType,
      })
      toast.success(`Fingerprint registered for ${partyName}`, {
        description: `${hand} ${finger} · ${scannerType === 'external' ? 'USB OTG (MFS100)' : 'Native sensor'}`,
      })
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.message || 'Failed to register fingerprint')
    } finally {
      setScanning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-emerald-600" />
            Register Fingerprint
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Map {partyName}&apos;s fingerprint to their account for one-touch khata &amp; billing access.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Hand</Label>
              <select
                value={hand}
                onChange={(e) => setHand(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Finger</Label>
              <select
                value={finger}
                onChange={(e) => setFinger(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="thumb">Thumb</option>
                <option value="index">Index</option>
                <option value="middle">Middle</option>
                <option value="ring">Ring</option>
                <option value="pinky">Pinky</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Scanner Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setScannerType('native')}
                className={`h-10 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                  scannerType === 'native' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600' : 'border-border bg-background'
                }`}
              >
                <Fingerprint className="w-3.5 h-3.5" /> Native Sensor
              </button>
              <button
                onClick={() => setScannerType('external')}
                className={`h-10 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                  scannerType === 'external' ? 'border-purple-500 bg-purple-500/10 text-purple-600' : 'border-border bg-background'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" /> USB OTG (MFS100)
              </button>
            </div>
          </div>
          {/* Animated fingerprint scan visualization */}
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="relative w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Fingerprint className={`w-12 h-12 text-emerald-600 ${scanning ? 'animate-pulse' : ''}`} />
              {scanning && (
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-emerald-500"
                  animate={{ scale: [1, 1.15, 1], opacity: [1, 0, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {scanning ? 'Scanning fingerprint...' : 'Ready to scan'}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11" disabled={scanning}>Cancel</Button>
          <Button onClick={handleScan} className="h-11 flex-1" disabled={scanning}>
            {scanning ? (
              <><Fingerprint className="w-4 h-4 mr-1.5 animate-pulse" /> Scanning...</>
            ) : (
              <><Fingerprint className="w-4 h-4 mr-1.5" /> Scan & Register</>
            )}
          </Button>
        </DialogFooter>
      </FormDialogContent>
    </Dialog>
  )
}
