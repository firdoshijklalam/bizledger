/**
 * §AUTO-DEPLOY DISABLED (sandbox recovery session 2026-10-06):
 * The instrumentation auto-push loop was disabled because the sandbox
 * has no GitHub push credentials, causing noisy retry loops, and any
 * accidental `git push origin main` from a non-main HEAD would be
 * destructive. Dev/prod behavior is otherwise unchanged.
 */
export async function register() {
  // no-op
}
