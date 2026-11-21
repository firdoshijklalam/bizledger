// Smart Voice Entity Parsing (PRD v2 §12.3)
// Extract structured entities from Bengali/English voice transcripts.
//
// Examples:
//   "অমিত ট্রেডিং ৫০০ টাকা জমা" → { customer: "অমিত ট্রেডিং", amount: 500, type: "credit" }
//   "২ পিস LED বাল্ব" → { item: "LED বাল্ব", quantity: 2 }

export interface ParsedVoiceEntities {
  amount?: number
  type?: 'credit' | 'debit'
  customerName?: string
  itemName?: string
  quantity?: number
  raw: string
}

// Bengali digits → English
const BN_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

function normalizeDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d)
}

/** Parse a voice transcript into structured entities. */
export function parseVoiceEntities(transcript: string): ParsedVoiceEntities {
  const raw = transcript
  const text = normalizeDigits(transcript)
  const result: ParsedVoiceEntities = { raw }

  // Amount extraction — supports "500 টাকা", "500 rs", "₹500", "500 rupees"
  const amountMatch = text.match(/(\d[\d,]*)\s*(?:টাকা|rs|₹|rupees|taka|কে? টাকা)/i)
  if (amountMatch) {
    result.amount = Number(amountMatch[1].replace(/,/g, ''))
  } else {
    // Standalone number
    const numMatch = text.match(/(\d[\d,]*)/)
    if (numMatch) {
      result.amount = Number(numMatch[1].replace(/,/g, ''))
    }
  }

  // Transaction type — credit (জমা/received/credit/পেয়েছি) or debit (বাকি/দিলাম/paid/debit)
  if (/(জমা|received|credit|পেয়েছি|পেলাম|টাকা পেলাম|এসেছে)/i.test(text)) {
    result.type = 'credit'
  } else if (/(বাকি|দিলাম|paid|debit|দিয়েছি|পরিশোধ)/i.test(text)) {
    result.type = 'debit'
  }

  // Quantity extraction — "২ পিস", "2 pcs", "2 piece", "২ টা"
  const qtyMatch = text.match(/(\d+)\s*(?:পিস|pcs|piece|টা|টি|kg|কেজি|bag|বস্তা)/i)
  if (qtyMatch) {
    result.quantity = Number(qtyMatch[1])
  }

  // Customer name — text before amount/type keywords
  // Pattern: "[Name] [amount] [type]"
  const nameMatch = text.match(/^([^\d]+?)(?:\s+\d|\s+(?:টাকা|rs|₹))/)
  if (nameMatch) {
    const candidate = nameMatch[1].trim()
    // Filter out common filler words
    if (candidate.length > 1 && candidate.length < 40) {
      result.customerName = candidate
    }
  }

  // Item name — text after quantity
  const itemMatch = text.match(/(?:\d+\s*(?:পিস|pcs|piece|টা|টি|kg|কেজি|bag|বস্তা)\s+)([^\d]+)/i)
  if (itemMatch) {
    result.itemName = itemMatch[1].trim()
  }

  return result
}

/** Format parsed entities into a human-readable summary. */
export function formatParsedEntities(parsed: ParsedVoiceEntities): string {
  const parts: string[] = []
  if (parsed.customerName) parts.push(`Customer: ${parsed.customerName}`)
  if (parsed.amount) parts.push(`Amount: ₹${parsed.amount}`)
  if (parsed.type) parts.push(`Type: ${parsed.type === 'credit' ? 'পেলাম (received)' : 'দিলাম (paid)'}`)
  if (parsed.itemName) parts.push(`Item: ${parsed.itemName}`)
  if (parsed.quantity) parts.push(`Qty: ${parsed.quantity}`)
  return parts.join(' · ') || 'No entities detected'
}
