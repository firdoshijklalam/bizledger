/**
 * §P16-STEP3.8.1-DRILLDOWN: Profit/Loss rule-based explainer.
 *
 * Pure functions — NO AI, NO LLM, NO external API calls.
 *
 * §CORRECTION-1 (Accounting explanation rule):
 * Inventory purchases are an ASSET MOVEMENT (cash → inventory), NOT a P&L
 * expense. COGS is recognized only when inventory is SOLD. This explainer
 * NEVER describes inventory purchase as a P&L loss cause.
 *
 * §CORRECTION-5 (Accounting semantics — verbatim):
 *   Net Profit = Net Revenue - COGS - Authoritative Operating Expense
 *
 * The input is ALWAYS the server-authoritative summary from
 * /api/dashboard/breakdown. The client NEVER provides these values.
 */

export interface ProfitLossSummary {
  netRevenue: number
  cogs: number
  grossProfit: number
  operatingExpense: number  // AUTHORITATIVE ONLY
  legacyOpEx: number         // disclosed separately, NOT in netProfit
  netProfit: number          // CAN BE NEGATIVE
}

export type Severity = 'positive' | 'negative' | 'neutral'

export interface ContributingFactor {
  label: string
  value: number
  impact: 'positive' | 'negative' | 'neutral'
}

export interface ProfitLossExplanation {
  primaryReason: string
  primarySeverity: Severity
  contributingFactors: ContributingFactor[]
}

/**
 * §EXPLAIN: Generate a rule-based explanation for the P&L of a bucket.
 *
 * Rules (approved v3 plan §5.1):
 *   1. Loss + COGS > Net Revenue     → "Loss is primarily driven by the cost of products sold exceeding net revenue."
 *   2. Loss + OpEx > Gross Profit    → "Loss is primarily driven by operating expenses exceeding gross profit."
 *   3. Profit (revenue > costs+OpEx) → "Profit is primarily driven by net revenue exceeding the combined cost of products sold and operating expenses."
 *   4. Break-even (netProfit === 0)  → "The period broke even — net revenue exactly matched costs and expenses."
 *   5. Default                       → "Net profit for the period reflects the balance of revenue, product costs, and operating expenses."
 *
 * §FORBIDDEN: This function NEVER produces output that mentions "stock
 * purchase", "inventory purchase", "purchasing inventory", or any phrase
 * implying inventory purchase is a P&L expense. Inventory purchases are an
 * asset movement, NOT a P&L expense.
 */
export function explainProfitLoss(summary: ProfitLossSummary): ProfitLossExplanation {
  const { netRevenue, cogs, grossProfit, operatingExpense, netProfit } = summary

  // §CONTRIBUTING-FACTORS: Always list the 3 P&L components with impact flags.
  // Net Revenue → positive if > 0 (it contributes to profit)
  // COGS → negative if > 0 (it reduces profit)
  // Operating Expense → negative if > 0 (it reduces profit)
  const contributingFactors: ContributingFactor[] = [
    {
      label: 'Net Revenue',
      value: netRevenue,
      impact: netRevenue > 0 ? 'positive' : 'neutral',
    },
    {
      label: 'COGS',
      value: cogs,
      impact: cogs > 0 ? 'negative' : 'neutral',
    },
    {
      label: 'Operating Expense',
      value: operatingExpense,
      impact: operatingExpense > 0 ? 'negative' : 'neutral',
    },
  ]

  // §RULE-4: Break-even — netProfit is exactly 0
  if (netProfit === 0) {
    return {
      primaryReason:
        'The period broke even — net revenue exactly matched costs and expenses.',
      primarySeverity: 'neutral',
      contributingFactors,
    }
  }

  // §LOSS-CASES (netProfit < 0)
  if (netProfit < 0) {
    // §RULE-1: Loss + COGS > Net Revenue → COGS is the primary driver
    if (cogs > netRevenue) {
      return {
        primaryReason:
          'Loss is primarily driven by the cost of products sold exceeding net revenue.',
        primarySeverity: 'negative',
        contributingFactors,
      }
    }

    // §RULE-2: Loss + Operating Expense > Gross Profit → OpEx is the primary driver
    if (operatingExpense > grossProfit) {
      return {
        primaryReason:
          'Loss is primarily driven by operating expenses exceeding gross profit.',
        primarySeverity: 'negative',
        contributingFactors,
      }
    }

    // §DEFAULT-LOSS: Loss but neither rule matches cleanly
    return {
      primaryReason:
        'Net profit for the period reflects the balance of revenue, product costs, and operating expenses.',
      primarySeverity: 'negative',
      contributingFactors,
    }
  }

  // §PROFIT-CASES (netProfit > 0)
  // §RULE-3: Profit + Net Revenue > (COGS + Operating Expense)
  if (netRevenue > cogs + operatingExpense) {
    return {
      primaryReason:
        'Profit is primarily driven by net revenue exceeding the combined cost of products sold and operating expenses.',
      primarySeverity: 'positive',
      contributingFactors,
    }
  }

  // §DEFAULT-PROFIT: Profit but rule 3 doesn't match cleanly
  return {
    primaryReason:
      'Net profit for the period reflects the balance of revenue, product costs, and operating expenses.',
    primarySeverity: 'positive',
    contributingFactors,
  }
}

/**
 * §FORBIDDEN-PHRASE-CHECK: Verify that an explanation never mentions
 * inventory purchase as a P&L cause. Used by tests to enforce Correction #1.
 *
 * Returns true if the explanation is SAFE (no forbidden phrases).
 * Returns false if any forbidden phrase is detected.
 */
const FORBIDDEN_PHRASES = [
  'stock purchase',
  'inventory purchase',
  'purchasing inventory',
  'stock purchased',
  'inventory purchased',
  'inventory cost caused',
  'stock purchase caused',
  'inventory purchase drove',
]

export function hasNoForbiddenPhrases(explanation: ProfitLossExplanation): boolean {
  const text = (explanation.primaryReason + ' ' +
    explanation.contributingFactors.map(f => f.label).join(' ')).toLowerCase()
  return !FORBIDDEN_PHRASES.some(phrase => text.includes(phrase))
}
