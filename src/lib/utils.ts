import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED',
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
  const sign = amount < 0 ? '-' : ''
  return `${sign}${symbol}${formatted}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

export function formatDate(date: string | Date | null | undefined, format = 'DD/MM/YYYY'): string {
  if (!date) return 'N/A'
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return 'N/A'
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`
    if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`
    return `${day}/${month}/${year}`
  } catch {
    return 'N/A'
  }
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return 'N/A'
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return 'N/A'
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    return `${formatDate(d)} ${time}`
  } catch {
    return 'N/A'
  }
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return 'N/A'
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return 'N/A'
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return formatDate(d)
  } catch {
    return 'N/A'
  }
}

export function generateInvoiceNumber(prefix: string, count: number): string {
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${String(count).padStart(4, '0')}`
}

export function generateToken(length = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export const GRADE_META: Record<string, { label: string; color: string; bg: string; ring: string; desc: string }> = {
  A: { label: 'A', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/40', ring: 'ring-emerald-300', desc: 'Premium' },
  B: { label: 'B', color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-100 dark:bg-teal-900/40', ring: 'ring-teal-300', desc: 'Regular' },
  C: { label: 'C', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40', ring: 'ring-amber-300', desc: 'Wholesale' },
  D: { label: 'D', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/40', ring: 'ring-orange-300', desc: 'Slow Pay' },
  E: { label: 'E', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/40', ring: 'ring-red-300', desc: 'Defaulter' },
}

/**
 * Null-safe GRADE_META lookup. Always returns a valid meta object.
 * Falls back to grade 'B' (the schema default) for null/undefined/invalid grades.
 * Use this instead of GRADE_META[grade] to prevent "Cannot read properties of undefined" crashes.
 */
export function getGradeMeta(grade: string | null | undefined) {
  if (!grade) return GRADE_META['B']
  return GRADE_META[grade] ?? GRADE_META['B']
}

/**
 * Format a date as a relative "time ago" string.
 * e.g. "2s ago", "5m ago", "3h ago", "2d ago"
 */
export function formatDistanceToNow(date: Date | null | undefined): string {
  if (!date) return 'N/A'
  try {
    const now = Date.now()
    const diff = now - new Date(date).getTime()
    if (isNaN(diff)) return 'N/A'
    const sec = Math.floor(diff / 1000)
    const min = Math.floor(sec / 60)
    const hr = Math.floor(min / 60)
    const day = Math.floor(hr / 24)

    if (sec < 60) return `${sec}s ago`
    if (min < 60) return `${min}m ago`
    if (hr < 24) return `${hr}h ago`
    if (day < 7) return `${day}d ago`
    return new Date(date).toLocaleDateString()
  } catch {
    return 'N/A'
  }
}
