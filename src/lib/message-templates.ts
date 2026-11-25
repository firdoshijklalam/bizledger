import { useI18n } from '@/store/i18n-store'
import type { Language } from '@/store/i18n-store'
import { getRawOverride, type TemplateSlotId } from '@/store/message-template-store'

/**
 * §LOCALIZED-MESSAGE-TEMPLATES
 * Customer-facing share messages (payment reminders, follow-up nudges,
 * overdue reminders) previously hardcoded Bengali everywhere — so English
 * and Hindi users sent Bengali messages to their customers. This module
 * centralizes every customer-facing template with per-language variants.
 *
 * Templates follow the app's khata tone: polite, short, signed with the
 * business name, emoji-light (🙏 only), feature-phone friendly (plain text).
 * The app's current language is used as the template language by default —
 * the merchant knows which language their customer reads.
 */

export type MessageDirection = 'receivable' | 'payable'

/** Follow-up types from the FollowUp model (subset with dedicated templates). */
export type FollowUpMessageType =
  | 'payment_reminder'
  | 'product_feedback'
  | 'complaint_followup'
  | 'reorder_reminder'
  | 'warranty_expiry'
  | 'generic'

function currentLanguage(): Language {
  try {
    return useI18n.getState().language
  } catch {
    return 'en'
  }
}

/**
 * §TEMPLATE-OVERRIDES — resolve a per-business custom template for a slot.
 * Custom templates (Settings → Templates) support the placeholders
 * {party} {amount} {business} {bill}; unknown placeholder tokens are left
 * as-is so the merchant sees them and can fix the template. Returns null
 * when no override exists (callers fall back to the built-in default).
 */
function resolveOverride(
  slot: TemplateSlotId,
  lang: Language,
  vars: { partyName?: string; amount?: string; businessName?: string; invoiceNumber?: string }
): string | null {
  const raw = getRawOverride(slot, lang)
  if (!raw) return null
  let out = raw
  // Tokens whose value was not provided stay as literal {token} text —
  // the merchant sees them in the sent message and can fix the template.
  if (vars.partyName !== undefined) out = out.split('{party}').join(vars.partyName)
  if (vars.amount !== undefined) out = out.split('{amount}').join(vars.amount)
  if (vars.businessName !== undefined) out = out.split('{business}').join(vars.businessName)
  if (vars.invoiceNumber !== undefined) out = out.split('{bill}').join(vars.invoiceNumber)
  return out
}

/**
 * §PAYMENT-REMINDER — balance-aware reminder sent from a party profile.
 *   - receivable → "you owe us ₹X, kindly pay"
 *   - payable    → "we owe you ₹X, settling soon"
 */
export function paymentReminderMessage(opts: {
  partyName: string
  amount: string
  direction: MessageDirection
  businessName: string
  language?: Language
}): string {
  const lang = opts.language ?? currentLanguage()
  const { partyName, amount, businessName } = opts

  // §TEMPLATE-OVERRIDES: business-custom template wins (per language).
  const overridden = resolveOverride(
    opts.direction === 'receivable' ? 'paymentReceivable' : 'paymentPayable',
    lang,
    { partyName, amount, businessName }
  )
  if (overridden) return overridden

  if (lang === 'bn') {
    if (opts.direction === 'receivable') {
      return [
        `নমস্কার ${partyName} 🙏`,
        ``,
        `${businessName} থেকে একটি সৌজন্যমূলক অনুস্মারক — আপনার কাছে ${amount} বাকি রয়েছে।`,
        `সুবিধামতো সময়ে পরিশোধ করলে কৃতজ্ঞ হব। ধন্যবাদ! 🙏`,
        ``,
        `— ${businessName}`,
      ].join('\n')
    }
    return [
      `নমস্কার ${partyName} 🙏`,
      ``,
      `${businessName} থেকে জানাচ্ছি — আমাদের কাছে আপনার ${amount} পাওনা রয়েছে।`,
      `শীঘ্রই পরিশোধের ব্যবস্থা করছি। ধন্যবাদ!`,
      ``,
      `— ${businessName}`,
    ].join('\n')
  }

  if (lang === 'hi') {
    if (opts.direction === 'receivable') {
      return [
        `नमस्ते ${partyName} 🙏`,
        ``,
        `${businessName} की ओर से एक विनम्र अनुस्मारक — आपके ऊपर ${amount} बकाया है।`,
        `सुविधानुसार समय पर भुगतान करें तो कृतज्ञता रहेगी। धन्यवाद! 🙏`,
        ``,
        `— ${businessName}`,
      ].join('\n')
    }
    return [
      `नमस्ते ${partyName} 🙏`,
      ``,
      `${businessName} की ओर से सूचना — हमारे पास आपके ${amount} देय हैं।`,
      `शीघ्र ही भुगतान की व्यवस्था कर रहे हैं। धन्यवाद!`,
      ``,
      `— ${businessName}`,
    ].join('\n')
  }

  // English
  if (opts.direction === 'receivable') {
    return [
      `Hello ${partyName} 🙏`,
      ``,
      `A gentle reminder from ${businessName} — ${amount} is pending on your account.`,
      `Kindly clear it at your convenience. Thank you! 🙏`,
      ``,
      `— ${businessName}`,
    ].join('\n')
  }
  return [
    `Hello ${partyName} 🙏`,
    ``,
    `A note from ${businessName} — we owe you ${amount}.`,
    `We are arranging your settlement shortly. Thank you!`,
    ``,
    `— ${businessName}`,
  ].join('\n')
}

/**
 * §FOLLOWUP-MESSAGE — type-aware WhatsApp nudge from the follow-up detail
 * sheet. `generic` (callback / offer / birthday / manual / custom) falls
 * back to referencing the follow-up's own title.
 */
export function followUpMessage(opts: {
  partyName: string
  type: FollowUpMessageType
  title?: string
  language?: Language
}): string {
  const lang = opts.language ?? currentLanguage()
  const name = opts.partyName

  // §TEMPLATE-OVERRIDES: only the product_feedback type is user-customizable.
  if (opts.type === 'product_feedback') {
    const overridden = resolveOverride('feedback', lang, { partyName: name })
    if (overridden) return overridden
  }

  if (lang === 'bn') {
    switch (opts.type) {
      case 'payment_reminder':
        return `নমস্কার ${name} 🙏\n\nএকটি সৌজন্যমূলক অনুস্মারক — আমাদের কাছে আপনার বাকি পেমেন্ট রয়েছে। সুবিধামতো সময়ে পরিশোধ করলে কৃতজ্ঞ হব। ধন্যবাদ!`
      case 'product_feedback':
        return `নমস্কার ${name} 🙏\n\nসদ্য কেনা পণ্যটি কেমন লাগল জানাতে চাই। আপনার মতামত আমাদের সেবা আরও ভালো করতে সাহায্য করবে। একটু সময় নিয়ে জানাবেন কি? ধন্যবাদ!`
      case 'complaint_followup':
        return `নমস্কার ${name} 🙏\n\nআপনার অভিযোগের অগ্রগতি জানতে যোগাযোগ করছি। আপনার সমস্যাটি সমাধানে আমরা প্রতিশ্রুতিবদ্ধ। কিছু জানতে চাইলে বলুন।`
      case 'reorder_reminder':
        return `নমস্কার ${name} 🙏\n\nআপনার পছন্দের পণ্যটি সম্ভবত শেষ হয়ে আসছে — আবার অর্ডার করতে চাইলে জানান, দ্রুত পৌঁছে দেব। ধন্যবাদ!`
      case 'warranty_expiry':
        return `নমস্কার ${name} 🙏\n\nআপনার কেনা পণ্যের ওয়ারেন্টি শীঘ্রই শেষ হয়ে আসছে। প্রয়োজনে এই সুযোগে যোগাযোগ করুন।`
      default:
        return `নমস্কার ${name} 🙏\n\n${opts.title || ''}`
    }
  }

  if (lang === 'hi') {
    switch (opts.type) {
      case 'payment_reminder':
        return `नमस्ते ${name} 🙏\n\nएक विनम्र अनुस्मारक — आपका एक भुगतान हमारे यहाँ लंबित है। सुविधानुसार समय पर भुगतान करें तो कृतज्ञता रहेगी। धन्यवाद!`
      case 'product_feedback':
        return `नमस्ते ${name} 🙏\n\nहाल में खरीदे गए उत्पाद के बारे में आपकी राय जानना चाहते हैं। आपकी प्रतिक्रिया हमारी सेवा और बेहतर करने में मदद करेगी। थोड़ा समय देकर बताएंगे? धन्यवाद!`
      case 'complaint_followup':
        return `नमस्ते ${name} 🙏\n\nआपकी शिकायत की प्रगति जानने के लिए संपर्क कर रहे हैं। आपकी समस्या के समाधान के लिए हम प्रतिबद्ध हैं। कुछ पूछना हो तो बताएं।`
      case 'reorder_reminder':
        return `नमस्ते ${name} 🙏\n\nआपका पसंदीदा उत्पाद शायद खत्म होने वाला है — दोबारा ऑर्डर करना चाहें तो बताएं, जल्दी पहुँचा देंगे। धन्यवाद!`
      case 'warranty_expiry':
        return `नमस्ते ${name} 🙏\n\nआपके खरीदे उत्पाद की वारंटी जल्द खत्म होने वाली है। आवश्यकता हो तो इस अवसर पर संपर्क करें।`
      default:
        return `नमस्ते ${name} 🙏\n\n${opts.title || ''}`
    }
  }

  // English
  switch (opts.type) {
    case 'payment_reminder':
      return `Hello ${name} 🙏\n\nA gentle reminder — a payment is pending on your account with us. Kindly clear it at your convenience. Thank you!`
    case 'product_feedback':
      return `Hello ${name} 🙏\n\nHow is the product you recently purchased? Your feedback helps us serve you better. Could you take a moment to share? Thank you!`
    case 'complaint_followup':
      return `Hello ${name} 🙏\n\nChecking in on the complaint you raised — we are committed to resolving it. Let us know if you need anything.`
    case 'reorder_reminder':
      return `Hello ${name} 🙏\n\nYour favourite product may be running low — let us know if you'd like to reorder and we'll deliver quickly. Thank you!`
    case 'warranty_expiry':
      return `Hello ${name} 🙏\n\nThe warranty on your purchase is expiring soon. Reach out if you need anything before it does.`
    default:
      return `Hello ${name} 🙏\n\n${opts.title || ''}`
  }
}

/**
 * §OVERDUE-REMINDER — default template for the AI Reminders view (PRD Part 22).
 * `polite: true` produces the "AI rewritten" softer variant.
 */
export function overdueReminderMessage(opts: {
  partyName: string
  amount: string
  businessName: string
  invoiceNumber?: string
  polite?: boolean
  language?: Language
}): string {
  const lang = opts.language ?? currentLanguage()
  const { partyName, amount, businessName, invoiceNumber } = opts

  // §TEMPLATE-OVERRIDES: the business-custom template replaces the DEFAULT
  // (terse) variant. The `polite` "AI rewrite" variant stays built-in — it
  // is the AI's softened phrasing, not merchant copy.
  if (!opts.polite) {
    const overridden = resolveOverride('overdue', lang, {
      partyName, amount, businessName, invoiceNumber,
    })
    if (overridden) return overridden
  }

  const invoiceLine = invoiceNumber ? `বিল: ${invoiceNumber}\n` : ''

  if (lang === 'bn') {
    if (opts.polite) {
      return `নমস্কার ${partyName} জি 🙏\n\nআশা করি আপনি ভালো আছেন। এটি ${businessName} থেকে একটি বিনয়ী অনুরোধ।\n\nআপনার অ্যাকাউন্টে ${amount} বকেয়া রয়েছে${invoiceNumber ? ` (বিল: ${invoiceNumber})` : ''}। আপনার সুবিধামতো সময়ে পেমেন্ট করলে আমরা কৃতজ্ঞ থাকব।\n\nযদি কোনো সমস্যা থাকে তবে আমাদের জানান। আপনার সহযোগিতার জন্য ধন্যবাদ।\n\nশুভেচ্ছান্তে,\n${businessName}`
    }
    return `প্রিয় ${partyName},\n\nআপনার ${businessName}-এ বকেয়া টাকা রয়েছে: ${amount}\n${invoiceLine}অনুগ্রহ করে পেমেন্ট করুন। ধন্যবাদ 🙏`
  }

  if (lang === 'hi') {
    if (opts.polite) {
      return `नमस्ते ${partyName} जी 🙏\n\nआशा है आप कुशल हैं। यह ${businessName} की ओर से एक विनम्र अनुरोध है।\n\nआपके खाते पर ${amount} बकाया है${invoiceNumber ? ` (बिल: ${invoiceNumber})` : ''}। आपकी सुविधानुसार समय पर भुगतान करें तो हम कृतज्ञ रहेंगे।\n\nकोई समस्या हो तो हमें बताएं। आपके सहयोग के लिए धन्यवाद।\n\nशुभकामनाएं,\n${businessName}`
    }
    return `प्रिय ${partyName},\n\nआपका ${businessName} पर बकाया है: ${amount}\n${invoiceNumber ? `बिल: ${invoiceNumber}\n` : ''}कृपया भुगतान करें। धन्यवाद 🙏`
  }

  // English
  if (opts.polite) {
    return `Hello ${partyName} 🙏\n\nHope you are doing well. This is a gentle request from ${businessName}.\n\n${amount} is pending on your account${invoiceNumber ? ` (bill: ${invoiceNumber})` : ''}. We would be grateful if you could settle it at your convenience.\n\nIf there is any issue, do let us know. Thank you for your cooperation.\n\nWarm regards,\n${businessName}`
  }
  return `Dear ${partyName},\n\n${amount} is pending at ${businessName}.\n${invoiceNumber ? `Bill: ${invoiceNumber}\n` : ''}Kindly make the payment. Thank you 🙏`
}

/**
 * §SMS-SEGMENTS — estimate SMS segment count for a message.
 * GSM-7 basic charset: 160 chars single segment / 153 per additional.
 * Anything outside GSM-7 (Bengali, Hindi, emoji): 70 single / 67 additional.
 * Returns null for empty text.
 */
export function smsSegmentEstimate(text: string): { chars: number; segments: number; encoding: 'GSM-7' | 'UCS-2' } | null {
  const trimmed = text ?? ''
  if (!trimmed) return null
  const isGsm = /^[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u2000-\u20AC\u20A0-\u20BF]*$/.test(trimmed)
  const encoding: 'GSM-7' | 'UCS-2' = isGsm ? 'GSM-7' : 'UCS-2'
  const chars = trimmed.length
  const single = encoding === 'GSM-7' ? 160 : 70
  const multi = encoding === 'GSM-7' ? 153 : 67
  const segments = chars <= single ? 1 : Math.ceil(chars / multi)
  return { chars, segments, encoding }
}

/**
 * §DEFAULT-TEMPLATES — placeholder-ized mirrors of the built-in message
 * defaults, used by the Settings → Templates editor to prefill the textarea
 * (editing a known-good draft beats writing from scratch). MUST stay in
 * sync with the generators above: the message this produces with sample
 * data equals what a customer receives with no override set.
 */
export const DEFAULT_TEMPLATES: Record<TemplateSlotId, Record<Language, string>> = {
  paymentReceivable: {
    en: 'Hello {party} 🙏\n\nA gentle reminder from {business} — {amount} is pending on your account.\nKindly clear it at your convenience. Thank you! 🙏\n\n— {business}',
    bn: 'নমস্কার {party} 🙏\n\n{business} থেকে একটি সৌজন্যমূলক অনুস্মারক — আপনার কাছে {amount} বাকি রয়েছে।\nসুবিধামতো সময়ে পরিশোধ করলে কৃতজ্ঞ হব। ধন্যবাদ! 🙏\n\n— {business}',
    hi: 'नमस्ते {party} 🙏\n\n{business} की ओर से एक विनम्र अनुस्मारक — आपके ऊपर {amount} बकाया है।\nसुविधानुसार समय पर भुगतान करें तो कृतज्ञता रहेगी। धन्यवाद! 🙏\n\n— {business}',
  },
  paymentPayable: {
    en: 'Hello {party} 🙏\n\nA note from {business} — we owe you {amount}.\nWe are arranging your settlement shortly. Thank you!\n\n— {business}',
    bn: 'নমস্কার {party} 🙏\n\n{business} থেকে জানাচ্ছি — আমাদের কাছে আপনার {amount} পাওনা রয়েছে।\nশীঘ্রই পরিশোধের ব্যবস্থা করছি। ধন্যবাদ!\n\n— {business}',
    hi: 'नमस्ते {party} 🙏\n\n{business} की ओर से सूचना — हमारे पास आपके {amount} देय हैं।\nशीघ्र ही भुगतान की व्यवस्था कर रहे हैं। धन्यवाद!\n\n— {business}',
  },
  overdue: {
    en: 'Dear {party},\n\n{amount} is pending at {business}.\n{bill}Kindly make the payment. Thank you 🙏',
    bn: 'প্রিয় {party},\n\nআপনার {business}-এ বকেয়া টাকা রয়েছে: {amount}\n{bill}অনুগ্রহ করে পেমেন্ট করুন। ধন্যবাদ 🙏',
    hi: 'प्रिय {party},\n\nआपका {business} पर बकाया है: {amount}\n{bill}कृपया भुगतान करें। धन्यवाद 🙏',
  },
  feedback: {
    en: 'Hello {party} 🙏\n\nHow is the product you recently purchased? Your feedback helps us serve you better. Could you take a moment to share? Thank you!',
    bn: 'নমস্কার {party} 🙏\n\nসদ্য কেনা পণ্যটি কেমন লাগল জানাতে চাই। আপনার মতামত আমাদের সেবা আরও ভালো করতে সাহায্য করবে। একটু সময় নিয়ে জানাবেন কি? ধন্যবাদ!',
    hi: 'नमस्ते {party} 🙏\n\nहाल में खरीदे गए उत्पाद के बारे में आपकी राय जानना चाहते हैं। आपकी प्रतिक्रिया हमारी सेवा और बेहतर करने में मदद करेगी। थोड़ा समय देकर बताएंगे? धन्यवाद!',
  },
}

/**
 * §TEMPLATE-PREVIEW — render a slot's message the way the customer would
 * receive it, with sample data. Prefers the business's custom override,
 * falls back to the built-in default. `{bill}` resolves to "Bill: …" when a
 * sample invoice number is given, otherwise to the empty string.
 */
export function renderTemplatePreview(
  slot: TemplateSlotId,
  lang: Language,
  sample: { partyName: string; amount: string; businessName: string; invoiceNumber?: string }
): string {
  const raw = getRawOverride(slot, lang) ?? DEFAULT_TEMPLATES[slot]?.[lang] ?? DEFAULT_TEMPLATES[slot]?.en ?? ''
  return raw
    .split('{party}').join(sample.partyName)
    .split('{amount}').join(sample.amount)
    .split('{business}').join(sample.businessName)
    .split('{bill}').join(sample.invoiceNumber ? (lang === 'en' ? `Bill: ${sample.invoiceNumber}\n` : lang === 'hi' ? `बिल: ${sample.invoiceNumber}\n` : `বিল: ${sample.invoiceNumber}\n`) : '')
}
