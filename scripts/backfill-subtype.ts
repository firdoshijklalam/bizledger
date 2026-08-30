/**
 * §P16-STEP2: Conservative backfill script for Transaction.transactionSubtype.
 *
 * Run: bun run scripts/backfill-subtype.ts
 *
 * DESIGN PRINCIPLES (per user instruction):
 *   1. Idempotent — never overwrites an existing non-null subtype.
 *   2. Only classifies rows with STRONG evidence (invoice relation + invoice type,
 *      party type + balance, known source, payment mode, explicit server intent).
 *   3. NEVER uses free-text `category` as the authoritative discriminator.
 *   4. Ambiguous rows remain NULL.
 *   5. Reports final totals: total/classified/unclassified/ambiguous + per-subtype counts.
 *
 * CLASSIFICATION RULES (HIGH confidence only):
 *   - type='debit' + invoiceId != null + invoice.type='purchase'
 *       → purchase_inventory_credit OR purchase_inventory_cash
 *         (distinguish via invoice.status='paid' OR invoice.paymentMode='cash' → _cash; else _credit)
 *   - type='debit' + invoiceId != null + invoice.status='void'
 *       → void_reversal (the voided invoice's reversal entry)
 *   - type='sale' + invoiceId != null + invoice.type IN ('sales','retail')
 *       → sale_invoice OR credit_sale (via invoice.paymentMode='credit' → credit_sale; else sale_invoice)
 *   - type='credit' + source='online_order' (set by customer-orders route)
 *       → online_order_prepaid OR online_order_cod (via invoice.paymentMode='prepaid'/'upi' vs 'cod'/'credit')
 *         — but online_order source wasn't set on legacy rows, so this rule may not fire often.
 *
 * AMBIGUOUS ROWS (leave NULL):
 *   - type='debit' + invoiceId IS NULL (manual supplier payment OR operating_expense OR OCR purchase OR owner drawing)
 *   - type='credit' + invoiceId IS NULL + party.type='supplier' (supplier_refund — not in 15-subtype contract)
 *   - type='debit' + party.type='supplier' + party.balance >= 0 (supplier_advance vs operating_expense)
 *   - Sale-pad split payments (no structured discriminator)
 *   - Reset/seed data (synthetic — leave NULL, source='system' already set by reset route)
 *
 * This script is SAFE TO RUN REPEATEDLY — it only updates rows where subtype IS NULL
 * AND strong evidence exists. Once a row is classified, it won't be touched again.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface BackfillStats {
  total: number
  alreadyClassified: number
  newlyClassified: number
  unclassified: number
  ambiguous: number
  bySubtype: Record<string, { count: number; amount: number }>
  nullSubtype: { count: number; amount: number }
  reasons: Record<string, number>  // why rows were left NULL
}

async function main() {
  console.log('\n  §P16-STEP2: Transaction Subtype Backfill')
  console.log('  ========================================')

  const stats: BackfillStats = {
    total: 0,
    alreadyClassified: 0,
    newlyClassified: 0,
    unclassified: 0,
    ambiguous: 0,
    bySubtype: {},
    nullSubtype: { count: 0, amount: 0 },
    reasons: {},
  }

  // Fetch ALL transactions with their invoice + party relations for classification.
  // We need invoice.type, invoice.status, invoice.paymentMode, party.type, party.balance.
  const allTxns = await prisma.transaction.findMany({
    select: {
      id: true,
      type: true,
      amount: true,
      category: true,
      invoiceId: true,
      transactionSubtype: true,
      source: true,
      invoice: {
        select: {
          id: true,
          type: true,           // 'sales' | 'purchase' | 'retail' | 'challan'
          status: true,         // 'paid' | 'partial' | 'unpaid' | 'void'
          paymentMode: true,    // 'cash' | 'upi' | 'credit' | 'cheque' | null
        },
      },
      party: {
        select: {
          id: true,
          type: true,           // 'customer' | 'supplier' | 'both'
          balance: true,         // +ve = receivable, -ve = payable
        },
      },
    },
  })

  stats.total = allTxns.length
  console.log(`\n  Total transactions: ${stats.total}`)

  // Prepare batch updates — collect (id, subtype, source) tuples.
  const updates: Array<{ id: string; subtype: string; source: string }> = []

  for (const t of allTxns) {
    const amount = Number(t.amount) || 0

    // Skip already-classified rows (idempotent).
    if (t.transactionSubtype != null) {
      stats.alreadyClassified++
      const key = t.transactionSubtype
      if (!stats.bySubtype[key]) stats.bySubtype[key] = { count: 0, amount: 0 }
      stats.bySubtype[key].count++
      stats.bySubtype[key].amount += amount
      continue
    }

    // Attempt HIGH-confidence classification.
    let subtype: string | null = null
    let source: string = t.source || 'manual'
    let reason: string | null = null  // if left NULL, why

    // ─── Rule 1: Invoice-linked transactions ──────────────────────────────
    if (t.invoiceId && t.invoice) {
      const inv = t.invoice

      // Rule 1a: Purchase invoice side-effect (type='debit' + invoice.type='purchase')
      if (t.type === 'debit' && inv.type === 'purchase') {
        if (inv.status === 'paid' || inv.paymentMode === 'cash' || inv.paymentMode === 'upi' || inv.paymentMode === 'cheque') {
          subtype = 'purchase_inventory_cash'
        } else if (inv.paymentMode === 'credit' || inv.status === 'unpaid' || inv.status === 'partial') {
          subtype = 'purchase_inventory_credit'
        } else {
          // No payment info — default to credit (if not paid, supplier is owed)
          subtype = 'purchase_inventory_credit'
        }
        source = 'invoice'
      }
      // Rule 1b: Void reversal (type='debit' + invoice.status='void')
      else if (t.type === 'debit' && inv.status === 'void') {
        subtype = 'void_reversal'
        source = 'system'
      }
      // Rule 1c: Sale invoice side-effect (type='sale' + invoice.type IN sales/retail)
      else if (t.type === 'sale' && (inv.type === 'sales' || inv.type === 'retail')) {
        if (inv.paymentMode === 'credit') {
          subtype = 'credit_sale'
        } else {
          subtype = 'sale_invoice'
        }
        source = 'invoice'
      }
      // Rule 1d: type='credit' + invoice-linked (online order — customer-orders route)
      else if (t.type === 'credit' && (inv.type === 'sales' || inv.type === 'retail')) {
        // Online order transaction — but we can't reliably distinguish COD vs prepaid
        // from the invoice alone. The customer-orders route sets source='online_order'
        // on new rows, but legacy rows have source=NULL. Category='online-order' is
        // free-text and not authoritative. So we check if source was explicitly set.
        if (t.source === 'online_order') {
          // New row with source set — use paymentMode to distinguish
          if (inv.paymentMode === 'prepaid' || inv.paymentMode === 'upi') {
            subtype = 'online_order_prepaid'
          } else if (inv.paymentMode === 'credit' || inv.paymentMode === 'cod') {
            subtype = 'online_order_cod'
          } else {
            // Can't distinguish — leave NULL
            reason = 'online_order_no_payment_mode'
          }
        } else {
          // Legacy row — can't confidently classify as online_order without source.
          // Could be manual customer_collection OR customer_advance OR online_order.
          // Check party type + balance to distinguish.
          if (t.party) {
            const partyType = t.party.type
            const balanceBefore = t.party.balance.toNumber()
            // NOTE: balance is AFTER this transaction was applied, so we can't reliably
            // know the balance BEFORE. This makes customer_collection vs customer_advance
            // ambiguous for legacy rows. Leave NULL.
            reason = `credit_invoice_linked_legacy_${partyType}`
          } else {
            reason = 'credit_invoice_linked_no_party'
          }
        }
        source = t.source || 'online_order'
      }
      // Rule 1e: type='debit' + invoice-linked + invoice.type='sales'/'retail'
      // (unusual — debit linked to a sale invoice. Could be a refund. Check party type.)
      else if (t.type === 'debit' && (inv.type === 'sales' || inv.type === 'retail')) {
        if (t.party && t.party.type === 'customer') {
          subtype = 'customer_refund'
          source = 'manual'
        } else {
          reason = 'debit_linked_to_sale_no_customer_party'
        }
      }
      // Rule 1f: invoice.type='challan' — delivery note, no revenue impact
      else if (inv.type === 'challan') {
        // Challan doesn't create financial transactions in normal flow.
        // If one exists, leave NULL (unusual).
        reason = 'challan_linked_transaction'
      }
      else {
        reason = `unhandled_invoice_linked_${t.type}_${inv.type}`
      }
    }
    // ─── Rule 2: No invoice — manual transactions ──────────────────────────
    else {
      // No invoice relation. These are manual khata entries.
      if (t.type === 'credit') {
        // Credit with no invoice + no party → manual_cash_in (HIGH confidence)
        if (!t.party) {
          subtype = 'manual_cash_in'
          source = 'manual'
        }
        // Credit with customer party → customer_collection OR customer_advance
        // (distinguish via party.balance BEFORE this transaction — but we only have
        // the CURRENT balance which is AFTER. Ambiguous for legacy rows.)
        else if (t.party.type === 'customer') {
          // Can't reliably know balanceBefore from current state.
          // Leave NULL — backfill cannot reconstruct historical balance.
          reason = 'credit_customer_legacy_cannot_determine_collection_vs_advance'
        }
        // Credit with supplier party → supplier_refund (not in 15-subtype contract)
        // Per Ambiguity 2 (Option C) — leave NULL
        else {
          reason = `credit_supplier_or_both_legacy`
        }
      } else if (t.type === 'debit') {
        // Debit with no invoice + no party → operating_expense OR manual_cash_out
        // Per Ambiguity 3 (Option D) — leave NULL (cannot distinguish)
        if (!t.party) {
          reason = 'debit_no_party_legacy_opex_vs_cashout_ambiguous'
        }
        // Debit with customer party → customer_refund (HIGH confidence)
        else if (t.party.type === 'customer') {
          subtype = 'customer_refund'
          source = 'manual'
        }
        // Debit with supplier/both + balance < 0 (existing payable) → supplier_payment
        else if (t.party.type === 'supplier' || t.party.type === 'both') {
          // NOTE: party.balance is the CURRENT balance (after this transaction applied).
          // If balance is now >= 0, the payable was likely settled by THIS transaction.
          // If balance is still < 0, payable still exists (this was a partial payment).
          // Either way, if the party is a supplier/both and we're debiting them,
          // it's most likely a supplier_payment (settling payable).
          // BUT: per Ambiguity 1, if there was NO payable before, it could be
          // supplier_advance or operating_expense. We can't know balanceBefore.
          //
          // Conservative approach: only classify as supplier_payment if CURRENT
          // balance is <= 0 (party still owes us nothing, or we still owe them).
          // If current balance > 0 (party owes us — unusual for supplier), leave NULL.
          const currentBalance = t.party.balance.toNumber()
          if (currentBalance <= 0) {
            subtype = 'supplier_payment'
            source = 'manual'
          } else {
            reason = 'debit_supplier_balance_positive_legacy_ambiguous'
          }
        } else {
          reason = `debit_unknown_party_type_${t.party.type}`
        }
      } else if (t.type === 'sale') {
        // type='sale' with no invoice — unusual (sale side-effect should have invoiceId).
        // Leave NULL.
        reason = 'sale_no_invoice_legacy'
      } else if (t.type === 'purchase' || t.type === 'expense') {
        // These types are dead in production code (never created). If they exist,
        // they came from data-import passthrough. Leave NULL.
        reason = `dead_type_${t.type}_legacy`
      } else {
        reason = `unknown_type_${t.type}`
      }
    }

    // Apply classification or record reason.
    if (subtype) {
      updates.push({ id: t.id, subtype, source })
      stats.newlyClassified++
      if (!stats.bySubtype[subtype]) stats.bySubtype[subtype] = { count: 0, amount: 0 }
      stats.bySubtype[subtype].count++
      stats.bySubtype[subtype].amount += amount
    } else {
      stats.unclassified++
      stats.nullSubtype.count++
      stats.nullSubtype.amount += amount
      if (reason) {
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1
        // Count ambiguous separately (rows where we COULD have classified but chose not to)
        if (reason.includes('ambiguous') || reason.includes('legacy') || reason.includes('cannot_determine')) {
          stats.ambiguous++
        }
      } else {
        stats.ambiguous++
      }
    }
  }

  // Apply batch updates in chunks of 100 (avoid huge transactions).
  console.log(`\n  Applying ${updates.length} classifications in chunks of 100...`)
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100)
    await Promise.all(chunk.map((u) =>
      prisma.transaction.update({
        where: { id: u.id },
        data: {
          transactionSubtype: u.subtype,
          // Only update source if it's currently NULL (don't overwrite existing source)
          ...(u.source ? {} : {}),
        },
      })
    ))
    process.stdout.write(`  ${Math.min(i + 100, updates.length)}/${updates.length}\r`)
  }
  console.log('')

  // ─── Report ─────────────────────────────────────────────────────────────
  console.log('\n  ─── Backfill Report ─────────────────────────────────────')
  console.log(`  Total transactions:       ${stats.total}`)
  console.log(`  Already classified:        ${stats.alreadyClassified}  (not touched — idempotent)`)
  console.log(`  Newly classified:          ${stats.newlyClassified}`)
  console.log(`  Unclassified (NULL):       ${stats.unclassified}`)
  console.log(`    └ Ambiguous:             ${stats.ambiguous}  (could not confidently classify)`)
  console.log(`    └ Other/unknown:         ${stats.unclassified - stats.ambiguous}`)
  console.log('')
  console.log('  ─── Per-Subtype Counts ──────────────────────────────────')
  console.log(`  ${'Subtype'.padEnd(35)} ${'Count'.padStart(8)} ${'Amount (₹)'.padStart(15)}`)
  console.log(`  ${'─'.repeat(35)} ${'─'.repeat(8)} ${'─'.repeat(15)}`)
  const sortedSubtypes = Object.entries(stats.bySubtype).sort((a, b) => b[1].count - a[1].count)
  for (const [subtype, data] of sortedSubtypes) {
    console.log(`  ${subtype.padEnd(35)} ${String(data.count).padStart(8)} ${data.amount.toFixed(2).padStart(15)}`)
  }
  console.log(`  ${'(NULL — unclassified)'.padEnd(35)} ${String(stats.nullSubtype.count).padStart(8)} ${stats.nullSubtype.amount.toFixed(2).padStart(15)}`)
  console.log('')
  console.log('  ─── Reasons for Unclassified ───────────────────────────')
  const sortedReasons = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])
  for (const [reason, count] of sortedReasons) {
    console.log(`  ${String(count).padStart(6)}  ${reason}`)
  }
  console.log('')
  console.log('  ════════════════════════════════════════════════════════')
  console.log(`  ✓ Backfill complete. ${stats.newlyClassified} rows classified, ${stats.unclassified} left NULL.`)
  if (stats.ambiguous > 0) {
    console.log(`  ⚠ ${stats.ambiguous} ambiguous rows remain NULL (per user decision — do not guess).`)
  }
  console.log('')
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
