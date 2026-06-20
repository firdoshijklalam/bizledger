'use client'

import { useI18n } from '@/store/i18n-store'
import { motion } from 'framer-motion'
import {
  ScanLine, Mic, TrendingUp, Brain, Bell, Zap, ChevronRight, CheckCircle2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { useState } from 'react'
import { ForecastView } from './ai/forecast-view'
import { InsightsView } from './ai/insights-view'
import { RemindersView } from './ai/reminders-view'
import { OcrScannerView } from './ai/ocr-scanner-view'

type ToolId = 'forecast' | 'insights' | 'reminders' | 'ocr' | 'voice' | 'phonetic'

const TOOLS: Array<{
  id: ToolId
  icon: any
  title: string
  desc: string
  status: 'active' | 'info'
  color: string
}> = [
  {
    id: 'insights',
    icon: Brain,
    title: 'Business Insights',
    desc: 'Top products, debtors, revenue trends, collection rate & stock alerts.',
    status: 'active',
    color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  },
  {
    id: 'forecast',
    icon: TrendingUp,
    title: 'Demand Forecast',
    desc: '3-month demand prediction per product based on sales history & trends.',
    status: 'active',
    color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30',
  },
  {
    id: 'reminders',
    icon: Bell,
    title: 'Auto Reminders',
    desc: 'List overdue parties with one-tap WhatsApp reminder & call actions.',
    status: 'active',
    color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30',
  },
  {
    id: 'ocr',
    icon: ScanLine,
    title: 'OCR Bill Scanner',
    desc: 'Scan supplier bills with camera — AI extracts items, prices & totals.',
    status: 'active',
    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
  },
  {
    id: 'voice',
    icon: Mic,
    title: 'Global Voice Input',
    desc: 'Tap the mic in the top bar to speak — extracts amount, customer & items (Bengali/English).',
    status: 'info',
    color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30',
  },
  {
    id: 'phonetic',
    icon: Zap,
    title: 'Phonetic Search',
    desc: 'Search bar auto-matches Bengali ↔ English by sound. Try "miniket" to find "মিনিকেট".',
    status: 'info',
    color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30',
  },
]

export function AiToolsView() {
  const { t } = useI18n()
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)

  const handleTool = (tool: ToolId) => {
    if (tool === 'voice') {
      toast.info('🎤 Tap the mic icon in the top bar to start voice input')
      return
    }
    if (tool === 'phonetic') {
      toast.info('🔊 Open search and type "miniket" — it will find "Miniket Rice" by sound')
      return
    }
    setActiveTool(tool)
  }

  // Render active sub-view with back button
  if (activeTool) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setActiveTool(null)}
          className="text-xs text-primary font-medium flex items-center gap-1"
        >
          ← Back to AI Tools
        </button>
        {activeTool === 'forecast' && <ForecastView />}
        {activeTool === 'insights' && <InsightsView />}
        {activeTool === 'reminders' && <RemindersView />}
        {activeTool === 'ocr' && <OcrScannerView />}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 p-5 text-white shadow-lg"
      >
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5" />
          <h2 className="text-base font-bold">AI Tools & Smart Features</h2>
        </div>
        <p className="text-xs opacity-90">
          Intelligent automation — insights, forecasts, OCR scanning, voice input & phonetic search. All powered by AI.
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
                  onClick={() => handleTool(tool.id)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tool.color}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{tool.title}</p>
                      {tool.status === 'active' ? (
                        <Badge variant="secondary" className="text-[9px] h-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[9px] h-4 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          Ready
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{tool.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 self-center" />
                </button>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
