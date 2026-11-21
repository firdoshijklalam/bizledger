'use client'

import { LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center text-center py-16 px-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-xs mb-4">{description}</p>}
      {action}
    </motion.div>
  )
}

export function LoadingState({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
      <span className="ml-3 text-sm text-muted-foreground">{text}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
        <span className="text-destructive text-xl">!</span>
      </div>
      <p className="text-sm font-medium mb-1">Something went wrong</p>
      <p className="text-xs text-muted-foreground mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm text-primary font-medium">
          Try again
        </button>
      )}
    </div>
  )
}
