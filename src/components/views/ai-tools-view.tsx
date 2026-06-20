'use client'

import { useI18n } from '@/store/i18n-store'
import { motion } from 'framer-motion'
import {
  ScanLine, Mic, TrendingUp, Bell, Sparkles, Brain, Zap, Lock,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const TOOLS = [
  {
    id: 'ocr',
    icon: ScanLine,
    title: 'OCR Bill Scanner',
    desc: 'Scan supplier bills with camera and auto-extract items, prices, and totals.',
    status: 'Phase 2',
    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
  },
  {
    id: 'voice',
    icon: Mic,
    title: 'Global Voice Input',
    desc: 'Single screen-top mic with Bengali & English support. Double-click to type.',
    status: 'Phase 2',
    color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30',
  },
  {
    id: 'forecast',
    icon: TrendingUp,
    title: 'Demand Forecast',
    desc: 'AI-powered 3-month demand prediction based on sales history.',
    status: 'Phase 2',
    color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
  },
  {
    id: 'insights',
    icon: Brain,
    title: 'Business Insights',
    desc: 'Smart insights on top products, debtors, and stock expiry.',
    status: 'Phase 2',
    color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  },
  {
    id: 'reminders',
    icon: Bell,
    title: 'Auto Reminders',
    desc: 'Automated WhatsApp/SMS reminders for overdue payments.',
    status: 'Phase 2',
    color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30',
  },
  {
    id: 'phonetic',
    icon: Zap,
    title: 'Phonetic Search',
    desc: 'Cross-language Bengali ↔ English sound matching for products & parties.',
    status: 'Phase 2',
    color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30',
  },
]

export function AiToolsView() {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 p-5 text-white shadow-lg"
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5" />
          <h2 className="text-base font-bold">AI Tools & Smart Features</h2>
        </div>
        <p className="text-xs opacity-90">
          Intelligent automation to grow your business faster. Voice, OCR, forecasts, and smart insights.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-3">
        {TOOLS.map((tool, i) => {
          const Icon = tool.icon
          return (
            <motion.div
              key={tool.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="p-4 hover:shadow-md transition-shadow">
                <button
                  onClick={() => toast.info(`${tool.title} — coming in Phase 2`)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tool.color}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{tool.title}</p>
                      <Badge variant="secondary" className="text-[9px] h-4">{tool.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{tool.desc}</p>
                  </div>
                </button>
              </Card>
            </motion.div>
          )
        })}
      </div>

      <Card className="p-5 bg-muted/30">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-purple-600" />
          </span>
          <div>
            <p className="text-sm font-semibold">Phase 3 — Biometric & SaaS</p>
            <p className="text-xs text-muted-foreground mt-1">
              Fingerprint customer recognition, cross-merchant defaulter alerts, multi-tenant isolation, and hybrid cloud backup (Telegram + Google Drive).
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
