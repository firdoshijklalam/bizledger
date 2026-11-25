#!/usr/bin/env bash
# §RUN-ALL-TESTS: executes every unit + integration suite with bun.
#
# History: the old `test` script chained 44 files with `npx tsx` prefixes —
# broken since tsx@latest flipped to CJS (`npx tsx` fails outright), and it
# also silently missed suites added after the list was written (the
# feedback/followup/reward families). This glob-based runner picks up every
# tests/unit/*.test.ts + tests/integration/*.test.ts automatically.
#
# §PG-SKIP: suites that need a real PostgreSQL instance (e.g.
# complaints-pg-concurrency) probe their port and SKIP with exit 0 when it
# is unreachable — `bun run test` stays green on SQLite-only environments
# while CI (which provisions PG) still runs them fully.
#
# Usage: bun run test   (or: bash scripts/run-all-tests.sh)

set -u
cd "$(dirname "$0")/.."

total=0
failed_suites=0

run_suite() {
  local f="$1"
  total=$((total + 1))
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "▶ $f"
  echo "══════════════════════════════════════════════════════════════"
  if ! bun "$f"; then
    # §RETRY-ONCE: transient sandbox flakes exist when 78 suites run in
    # sequence (each spawns its own Prisma client + engine; occasionally an
    # engine responds empty under resource pressure — e.g. cross-db-sql,
    # which passes standalone every time). Retry ONCE so a genuine failure
    # still fails the run while an engine hiccup doesn't.
    echo "⚠️  first attempt failed — retrying once (transient-engine-flake guard)…"
    if ! bun "$f"; then
      failed_suites=$((failed_suites + 1))
      echo "❌ SUITE FAILED: $f"
    else
      echo "✅ passed on retry: $f"
    fi
  fi
}

for f in tests/unit/*.test.ts; do
  run_suite "$f"
done

for f in tests/integration/*.test.ts; do
  run_suite "$f"
done

echo ""
echo "══════════════════════════════════════════════════════════════"
if [ "$failed_suites" -eq 0 ]; then
  echo "✨ ALL $total SUITES PASSED"
  exit 0
else
  echo "❌ $failed_suites of $total suites FAILED"
  exit 1
fi
