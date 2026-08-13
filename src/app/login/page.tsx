'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Loader2, Lock, Mail, AlertCircle, ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingAuth, setCheckingAuth] = useState(true)

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.ok && data?.user) {
          router.replace('/')
        } else {
          setCheckingAuth(false)
        }
      })
      .catch(() => setCheckingAuth(false))
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        router.replace('/')
        router.refresh()
      } else if (res.status === 429) {
        setError(data.error || 'Too many attempts. Please wait 15 minutes.')
      } else {
        setError(data.error || 'Invalid email or password')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-900 via-slate-900 to-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        {/* Logo + Title */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-600/30">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">BizLedger</h1>
          <p className="text-sm text-white/60 mt-1">Digital Khata for Modern Business</p>
        </div>

        {/* Login Card */}
        <div className="bg-card rounded-2xl border border-border shadow-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-center">Sign In</h2>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleLogin} className="space-y-3">
            {/* Email */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@bizledger.app"
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 pl-10 pr-10 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/40 mt-6">
          © 2026 BizLedger. All rights reserved.
        </p>
      </motion.div>
    </div>
  )
}
