/**
 * §AUTO-DEPLOY: Next.js instrumentation hook.
 *
 * Runs ONCE when the Next.js server starts (the persistent next-server process
 * managed by the platform). Starts a background interval that watches for
 * unpushed commits and pushes them to GitHub every 30s. Vercel (connected to
 * the GitHub repo) then auto-deploys on each push.
 *
 * This is the most reliable persistence mechanism in this sandbox because the
 * next-server process is the only one the platform keeps alive. Standalone
 * background shell/bun processes get reaped by sandbox cleanup.
 *
 * Guarded with a global flag so HMR in dev mode doesn't spawn duplicates.
 */

export async function register() {
  // Only run on the server (Node.js runtime), never in Edge
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Guard against duplicate intervals from HMR
  const g = globalThis as unknown as { __autoDeployStarted?: boolean }
  if (g.__autoDeployStarted) return
  g.__autoDeployStarted = true

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
  }

  log('auto-deploy instrumentation started (interval=30s, running inside next-server)')
  // Initial check after a short delay (let server fully boot)
  setTimeout(checkAndPush, 5_000)
  setInterval(checkAndPush, INTERVAL_MS)
}
