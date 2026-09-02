/**
 * §TEST: Phase 16 Step 3.8.1 — Profit/Loss Explainer unit tests.
 *
 * Run: npx tsx tests/unit/profit-loss-explainer.test.ts
 *
 * §CLASSIFICATION: REAL PRODUCTION FUNCTION.
 *   Tests the ACTUAL exported `explainProfitLoss()` + `hasNoForbiddenPhrases()`
 *   from `src/lib/profit-loss-explainer.ts`. NO mocks, NO mirrors, NO duplicates.
 *
 * §CORRECTION-1: Inventory purchases are an ASSET MOVEMENT, NOT a P&L expense.
 *   The explainer NEVER describes inventory purchase as a P&L loss cause.
 *
 * §CORRECTION-5: Net Profit = Net Revenue - COGS - Authoritative Operating Expense.
 */

import { explainProfitLoss, hasNoForbiddenPhrases, type ProfitLossSummary } from '../../src/lib/profit-loss-explainer'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

async function main() {
  console.log('\n  Phase 16 Step 3.8.1 — Profit/Loss Explainer Unit Tests')
  console.log('  ========================================================')

  // ─── A. COGS-driven loss ────────────────────────────────────────────
  console.log('\n  A — COGS-driven loss:')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 500, cogs: 1500, grossProfit: -1000,
      operatingExpense: 0, legacyOpEx: 0, netProfit: -1000,
    }
    const e = explainProfitLoss(summary)
    assert(
      e.primaryReason === 'Loss is primarily driven by the cost of products sold exceeding net revenue.',
      `A: COGS-driven loss message (got: "${e.primaryReason}")`,
    )
    assert(e.primarySeverity === 'negative', 'A: severity=negative')
    assert(hasNoForbiddenPhrases(e), 'A: no forbidden phrases (no inventory purchase mention)')
  }

  // ─── B. OpEx-driven loss ─────────────────────────────────────────────
  console.log('\n  B — OpEx-driven loss:')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 1000, cogs: 200, grossProfit: 800,
      operatingExpense: 1300, legacyOpEx: 0, netProfit: -500,
    }
    const e = explainProfitLoss(summary)
    assert(
      e.primaryReason === 'Loss is primarily driven by operating expenses exceeding gross profit.',
      `B: OpEx-driven loss message (got: "${e.primaryReason}")`,
    )
    assert(e.primarySeverity === 'negative', 'B: severity=negative')
    assert(hasNoForbiddenPhrases(e), 'B: no forbidden phrases')
  }

  // ─── C. Profit (revenue > cogs + OpEx) ──────────────────────────────
  console.log('\n  C — Profit (revenue-driven):')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 1500, cogs: 500, grossProfit: 1000,
      operatingExpense: 200, legacyOpEx: 0, netProfit: 800,
    }
    const e = explainProfitLoss(summary)
    assert(
      e.primaryReason === 'Profit is primarily driven by net revenue exceeding the combined cost of products sold and operating expenses.',
      `C: profit message (got: "${e.primaryReason}")`,
    )
    assert(e.primarySeverity === 'positive', 'C: severity=positive')
    assert(hasNoForbiddenPhrases(e), 'C: no forbidden phrases')
  }

  // ─── D. Break-even ──────────────────────────────────────────────────
  console.log('\n  D — Break-even:')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 500, cogs: 300, grossProfit: 200,
      operatingExpense: 200, legacyOpEx: 0, netProfit: 0,
    }
    const e = explainProfitLoss(summary)
    assert(
      e.primaryReason === 'The period broke even — net revenue exactly matched costs and expenses.',
      `D: break-even message (got: "${e.primaryReason}")`,
    )
    assert(e.primarySeverity === 'neutral', 'D: severity=neutral')
  }

  // ─── E. Default rule (profit but revenue ≤ cogs+OpEx) ───────────────
  console.log('\n  E — Default rule (profit, but revenue ≤ cogs+OpEx):')
  {
    // netProfit=50 > 0, but netRevenue=600 is NOT > (cogs=400 + OpEx=150=550) — wait, 600 > 550, so Rule 3 fires.
    // To hit default-profit: netProfit > 0 but netRevenue ≤ cogs + OpEx.
    // Example: netRevenue=500, cogs=400, grossProfit=100, OpEx=50, netProfit=50.
    //   cogs+OpEx=450, netRevenue=500 > 450 → Rule 3 fires.
    // Need: netRevenue ≤ cogs + OpEx but netProfit > 0.
    //   netProfit = grossProfit - OpEx = (netRevenue - cogs) - OpEx.
    //   For netProfit > 0: netRevenue - cogs > OpEx → netRevenue > cogs + OpEx.
    //   Contradiction — if netProfit > 0, then netRevenue > cogs + OpEx (Rule 3 always fires for profit).
    //   So default-profit is unreachable. Test default-LOSS instead.
    //   netProfit < 0 but cogs ≤ netRevenue AND OpEx ≤ grossProfit.
    //   Example: netRevenue=1000, cogs=800, grossProfit=200, OpEx=250, netProfit=-50.
    //   cogs(800) ≤ netRevenue(1000) → Rule 1 no. OpEx(250) > grossProfit(200) → Rule 2 yes.
    //   Need OpEx ≤ grossProfit: OpEx=150, grossProfit=200, netProfit=50 → profit.
    //   For default-loss: netProfit < 0, cogs ≤ netRevenue, OpEx ≤ grossProfit.
    //   netProfit = grossProfit - OpEx < 0 → OpEx > grossProfit. Contradiction with OpEx ≤ grossProfit.
    //   So default-loss is also unreachable. Both defaults are unreachable.
    //   Test the default message indirectly by verifying Rule 3 covers all profit cases.
    const summary: ProfitLossSummary = {
      netRevenue: 1000, cogs: 800, grossProfit: 200,
      operatingExpense: 150, legacyOpEx: 0, netProfit: 50,
    }
    const e = explainProfitLoss(summary)
    // Rule 3 fires (1000 > 800+150=950)
    assert(
      e.primaryReason === 'Profit is primarily driven by net revenue exceeding the combined cost of products sold and operating expenses.',
      `E: default-profit falls through to Rule 3 (got: "${e.primaryReason}")`,
    )
    assert(e.primarySeverity === 'positive', 'E: severity=positive')
  }

  // ─── F. Contributing factors ────────────────────────────────────────
  console.log('\n  F — Contributing factors:')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 1500, cogs: 500, grossProfit: 1000,
      operatingExpense: 200, legacyOpEx: 50, netProfit: 800,
    }
    const e = explainProfitLoss(summary)
    assert(e.contributingFactors.length === 3, `F: 3 contributing factors (got ${e.contributingFactors.length})`)
    const rev = e.contributingFactors.find(f => f.label === 'Net Revenue')
    const cogs = e.contributingFactors.find(f => f.label === 'COGS')
    const opex = e.contributingFactors.find(f => f.label === 'Operating Expense')
    assert(!!rev, 'F: Net Revenue factor exists')
    assert(!!cogs, 'F: COGS factor exists')
    assert(!!opex, 'F: Operating Expense factor exists')
    assert(rev!.value === 1500, `F: Net Revenue value=1500 (got ${rev!.value})`)
    assert(cogs!.value === 500, `F: COGS value=500 (got ${cogs!.value})`)
    assert(opex!.value === 200, `F: Operating Expense value=200 (got ${opex!.value})`)
    assert(rev!.impact === 'positive', `F: Net Revenue impact=positive (got ${rev!.impact})`)
    assert(cogs!.impact === 'negative', `F: COGS impact=negative (got ${cogs!.impact})`)
    assert(opex!.impact === 'negative', `F: Operating Expense impact=negative (got ${opex!.impact})`)
    // §NEVER-INCLUDES-LEGACY: contributing factors must NOT include legacyOpEx
    const legacy = e.contributingFactors.find(f => f.label.toLowerCase().includes('legacy') || f.label.toLowerCase().includes('unclassified'))
    assert(!legacy, 'F: legacy/unclassified NOT in contributing factors (never authoritative)')
  }

  // ─── G. Forbidden phrase protection ──────────────────────────────────
  console.log('\n  G — Forbidden phrase protection:')
  {
    // Test all 5 rule paths produce output free of forbidden phrases
    const summaries: ProfitLossSummary[] = [
      { netRevenue: 500, cogs: 1500, grossProfit: -1000, operatingExpense: 0, legacyOpEx: 0, netProfit: -1000 },   // Rule 1
      { netRevenue: 1000, cogs: 200, grossProfit: 800, operatingExpense: 1300, legacyOpEx: 0, netProfit: -500 },    // Rule 2
      { netRevenue: 1500, cogs: 500, grossProfit: 1000, operatingExpense: 200, legacyOpEx: 0, netProfit: 800 },     // Rule 3
      { netRevenue: 500, cogs: 300, grossProfit: 200, operatingExpense: 200, legacyOpEx: 0, netProfit: 0 },         // Rule 4
      { netRevenue: 0, cogs: 0, grossProfit: 0, operatingExpense: 0, legacyOpEx: 0, netProfit: 0 },                 // empty bucket
    ]
    for (let i = 0; i < summaries.length; i++) {
      const e = explainProfitLoss(summaries[i])
      const safe = hasNoForbiddenPhrases(e)
      assert(safe, `G${i}: rule ${i + 1} output has no forbidden phrases`)
      // §EXPLICIT-CHECK: verify each forbidden phrase is absent
      const text = (e.primaryReason + ' ' + e.contributingFactors.map(f => f.label).join(' ')).toLowerCase()
      const forbidden = ['stock purchase', 'inventory purchase', 'purchasing inventory', 'stock purchased', 'inventory purchased', 'inventory cost caused', 'stock purchase caused', 'inventory purchase drove']
      const found = forbidden.filter(p => text.includes(p))
      assert(found.length === 0, `G${i}: no forbidden phrase detected in rule ${i + 1} (found: ${found.join(', ') || 'none'})`)
    }
  }

  // ─── H. Empty bucket (all zeros) ────────────────────────────────────
  console.log('\n  H — Empty bucket (all zeros):')
  {
    const summary: ProfitLossSummary = {
      netRevenue: 0, cogs: 0, grossProfit: 0,
      operatingExpense: 0, legacyOpEx: 0, netProfit: 0,
    }
    const e = explainProfitLoss(summary)
    assert(e.primarySeverity === 'neutral', 'H: empty bucket severity=neutral (break-even)')
    assert(e.contributingFactors[0].impact === 'neutral', 'H: empty Net Revenue impact=neutral')
    assert(e.contributingFactors[1].impact === 'neutral', 'H: empty COGS impact=neutral')
    assert(e.contributingFactors[2].impact === 'neutral', 'H: empty OpEx impact=neutral')
  }

  // ─── I. Negative Net Profit with legacy OpEx present ─────────────────
  console.log('\n  I — Legacy OpEx does NOT affect explanation:')
  {
    // legacyOpEx is disclosed separately — it must NOT change the explanation
    // (Net Profit = Gross Profit - AUTHORITATIVE OpEx only)
    const summaryWithLegacy: ProfitLossSummary = {
      netRevenue: 500, cogs: 1500, grossProfit: -1000,
      operatingExpense: 0, legacyOpEx: 500, netProfit: -1000,
    }
    const summaryNoLegacy: ProfitLossSummary = {
      netRevenue: 500, cogs: 1500, grossProfit: -1000,
      operatingExpense: 0, legacyOpEx: 0, netProfit: -1000,
    }
    const e1 = explainProfitLoss(summaryWithLegacy)
    const e2 = explainProfitLoss(summaryNoLegacy)
    assert(
      e1.primaryReason === e2.primaryReason,
      'I: legacy OpEx does NOT change primaryReason (Net Profit uses authoritative OpEx only)',
    )
    assert(
      e1.primarySeverity === e2.primarySeverity,
      'I: legacy OpEx does NOT change primarySeverity',
    )
  }

  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
