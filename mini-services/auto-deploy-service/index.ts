/**
 * §AUTO-DEPLOY SERVICE
 * Watches for unpushed commits in /home/z/my-project and pushes them to GitHub.
 * Vercel (connected to the GitHub repo) then auto-deploys on each push.
 *
 * Runs as a persistent Bun mini-service with `bun --hot` (auto-restarts on file
 * change / crash). Exposes a tiny health endpoint on port 3010 so it conforms
 * to the mini-service convention and can be monitored.
 *
 * Check interval: 20s. Idempotent — only pushes when local main > origin/main.
 * Logs to /home/z/my-project/auto-deploy.log.
 */

import { execSync } from 'child_process'

const PROJECT_DIR = '/home/z/my-project'
const LOG_FILE = '/home/z/my-project/auto-deploy.log'
const PORT = 3010
const INTERVAL_MS = 20_000

function log(msg: string) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${ts}] ${msg}`
  console.log(line)
  try {
    const { appendFileSync } = require('fs')
    appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

function run(cmd: string): { ok: boolean; out: string } {
  try {
    const out = execSync(cmd, { cwd: PROJECT_DIR, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).toString()
    return { ok: true, out }
  } catch (e: any) {
    return { ok: false, out: (e?.stderr || e?.stdout || e?.message || '').toString() }
  }
}

function checkAndPush() {
  // Fetch remote state
  run('git fetch origin main')

  // Count commits local is ahead of origin/main
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

// --- Health HTTP server (tiny, just for monitoring) ---
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health' || url.pathname === '/') {
      const { out } = run('git rev-list --count origin/main..HEAD')
      const ahead = parseInt(out.trim(), 10) || 0
      return Response.json({
        ok: true,
        service: 'auto-deploy',
        unpushedCommits: ahead,
        lastCheck: new Date().toISOString(),
      })
    }
    return new Response('Not Found', { status: 404 })
  },
})

log(`auto-deploy service started on port ${PORT} (interval=${INTERVAL_MS / 1000}s)`)

// --- Main loop ---
checkAndPush() // initial check
setInterval(checkAndPush, INTERVAL_MS)

// Keep process alive
process.on('SIGTERM', () => { server.stop(); process.exit(0) })
process.on('SIGINT', () => { server.stop(); process.exit(0) })
