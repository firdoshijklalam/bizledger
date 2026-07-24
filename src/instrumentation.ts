/**
 * §AUTO-DEPLOY: Next.js instrumentation hook.
 *
 * SANDBOX-ONLY: This hook auto-pushes git commits to GitHub from the sandbox.
 * On Vercel (production), it does NOTHING — Vercel doesn't have git installed
 * in serverless functions, and the auto-push is only needed in the sandbox.
 *
 * The VERCEL env var is automatically set by Vercel. When it's '1', we skip
 * all instrumentation logic entirely.
 */

export async function register() {
  // Only run on the server (Node.js runtime), never in Edge
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // §CRITICAL: Skip entirely on Vercel production — no git, no filesystem access,
  // no persistent process. This prevents build/runtime errors on Vercel.
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return

  // Skip in production (non-sandbox)
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) return

  const g = globalThis as unknown as {
    __autoDeployInterval?: ReturnType<typeof setInterval>
    __autoDeployTimeout?: ReturnType<typeof setTimeout>
  }

  // Clear any stale interval from a previous register() call (HMR safety)
  if (g.__autoDeployInterval) clearInterval(g.__autoDeployInterval)
  if (g.__autoDeployTimeout) clearTimeout(g.__autoDeployTimeout)

  const PROJECT_DIR = '/home/z/my-project'
  const LOG_FILE = '/home/z/my-project/auto-deploy.log'
  const INTERVAL_MS = 30_000
  const fs = await import('fs')
  const { execSync } = await import('child_process')

  const log = (msg: string) => {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const line = `[${ts}] ${msg}`
    try { fs.appendFileSync(LOG_FILE, line + '\n') } catch {}
  }

  const run = (cmd: string): { ok: boolean; out: string } => {
    try {
      const out = execSync(cmd, { cwd: PROJECT_DIR, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).toString()
      return { ok: true, out }
    } catch (e: any) {
      return { ok: false, out: (e?.stderr || e?.stdout || e?.message || '').toString() }
    }
  }

  const checkAndPush = () => {
    try {
      run('git fetch origin main')
      const { ok, out } = run('git rev-list --count origin/main..HEAD')
      if (!ok) return
      const ahead = parseInt(out.trim(), 10) || 0
      if (ahead <= 0) return
      log(`Detected ${ahead} unpushed commit(s). Pushing to GitHub...`)
      const push = run('git push origin main')
      if (push.ok) {
        log('✓ Push successful — Vercel deployment triggered (if linked to GitHub repo).')
      } else {
        log(`✗ Push failed: ${push.out.slice(0, 200)}. Will retry next cycle.`)
      }
    } catch (e) {
      log(`✗ checkAndPush error: ${e}`)
    }
  }

  log('auto-deploy instrumentation started (interval=30s, running inside next-server)')
  // Initial check after a short delay (let server fully boot)
  g.__autoDeployTimeout = setTimeout(checkAndPush, 5_000)
  g.__autoDeployInterval = setInterval(checkAndPush, INTERVAL_MS)
}
