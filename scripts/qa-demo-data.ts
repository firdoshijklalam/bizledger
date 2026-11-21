// §QA-DEMO-DATA: One-shot script that populates the local dev DB with
// realistic CRM demo data covering every party-profile section, so the
// unified Messages / Complaints / Behaviour / Lifetime Profit / Rewards /
// Feedback / Follow-ups / Timeline / Notes features can be QA-verified in
// the browser. Run: bun run scripts/qa-demo-data.ts
import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth/session'

const H = 3600_000
const D = 24 * H
const now = Date.now()
const ago = (ms: number) => new Date(now - ms)
const ahead = (ms: number) => new Date(now + ms)

async function main() {
  const business = await db.business.findFirst({ where: { name: 'Sharma Trading Co.' } })
  if (!business) throw new Error('Seed business missing — run POST /api/seed first')

  // ── 1. Owner user (browser login) ───────────────────────────────────────
  const email = 'owner@bizledger.test'
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        passwordHash: hashPassword('Test@1234'),
        name: 'Rajesh Sharma',
        role: 'OWNER',
        businessId: business.id,
      },
    })
  }
  console.log('USER ready:', user.email)

  const parties = await db.party.findMany({ where: { businessId: business.id } })
  const amit = parties.find((p) => p.name === 'Amit Trading')!
  const sourav = parties.find((p) => p.name === 'Sourav Stores')!
  const rahul = parties.find((p) => p.name === 'Rahul Enterprise')!
  const defaulted = parties.find((p) => p.name === 'Defaulted Customer')!
  if (!amit || !sourav || !rahul || !defaulted) throw new Error('Seed parties missing')

  const products = await db.product.findMany({ where: { businessId: business.id } })
  console.log('products available:', products.length)

  // ── 2. Balances (UI reads party.balance) ────────────────────────────────
  await db.party.update({ where: { id: amit.id }, data: { balance: 4500 } })
  await db.party.update({ where: { id: sourav.id }, data: { balance: 12800 } })
  await db.party.update({ where: { id: rahul.id }, data: { balance: 2300 } })
  await db.party.update({ where: { id: defaulted.id }, data: { balance: 8900 } })

  // ── 3. Invoices + items (feed lifetime-profit) ─────────────────────────
  const mkInvoice = async (
    partyId: string, num: string, when: Date, paid: number,
    lines: { name: string; qty: number; price: number; cost: number }[]
  ) => {
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0)
    const grand = subtotal
    const inv = await db.invoice.create({
      data: {
        businessId: business.id, partyId, invoiceNumber: num, type: 'sales',
        status: paid >= grand ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        subtotal, grandTotal: grand, amountPaid: paid, amountDue: grand - paid,
        paymentMode: paid > 0 ? 'cash' : null, createdAt: when,
        items: {
          create: lines.map((l) => ({
            name: l.name, quantity: l.qty, unitPrice: l.price,
            total: l.qty * l.price, purchasePriceSnapshot: l.cost,
          })),
        },
      },
    })
    return inv
  }

  // Amit: lifetime revenue ≈ 12,480, COGS ≈ 10,300 → profit ≈ 2,180 across 3 orders
  const invA1 = await mkInvoice(amit.id, 'INV-1001', ago(21 * D), 3600, [
    { name: 'Premium Rice 25kg', qty: 6, price: 1150, cost: 980 },
    { name: 'Sunflower Oil 15L', qty: 4, price: 1900, cost: 1680 },
  ])
  const invA2 = await mkInvoice(amit.id, 'INV-1002', ago(9 * D), 0, [
    { name: 'Wheat Flour 50kg', qty: 5, price: 1450, cost: 1240 },
    { name: 'Sugar 25kg', qty: 3, price: 1180, cost: 1030 },
  ])
  const invA3 = await mkInvoice(amit.id, 'INV-1003', ago(2 * D), 1450, [
    { name: 'Tea Leaves 10kg', qty: 2, price: 2200, cost: 1950 },
  ])
  // Sourav: revenue ≈ 4,960, COGS ≈ 4,240 → profit ≈ 720
  const invS1 = await mkInvoice(sourav.id, 'INV-2001', ago(15 * D), 2200, [
    { name: 'Detergent Powder 10kg', qty: 4, price: 890, cost: 760 },
    { name: 'Soap Carton', qty: 8, price: 175, cost: 150 },
  ])
  const invS2 = await mkInvoice(sourav.id, 'INV-2002', ago(4 * D), 0, [
    { name: 'Shampoo 5L', qty: 2, price: 620, cost: 540 },
  ])
  // Rahul: revenue 2,400, COGS 2,050 → profit 350
  const invR1 = await mkInvoice(rahul.id, 'INV-3001', ago(6 * D), 2400, [
    { name: 'Biscuit Carton', qty: 6, price: 400, cost: 345 },
  ])
  console.log('invoices created: 6')

  // ── 4. Channel identities + conversations + messages ───────────────────
  await db.customerChannelIdentity.createMany({
    data: [
      { businessId: business.id, partyId: amit.id, channel: 'whatsapp', externalUserId: '919000011111', phoneNumber: '919000011111', displayName: 'Amit (WhatsApp)', verifiedAt: ago(30 * D) },
      { businessId: business.id, partyId: amit.id, channel: 'telegram', externalUserId: '510238844', externalUsername: '@amit_trading', displayName: 'Amit Trading TG' },
      { businessId: business.id, partyId: sourav.id, channel: 'whatsapp', externalUserId: '919000022222', phoneNumber: '919000022222', displayName: 'Sourav Stores (WA)' },
    ],
  })

  const convAmitWa = await db.conversation.create({
    data: {
      businessId: business.id, partyId: amit.id, channel: 'whatsapp',
      externalId: 'wa-thread-amit-001',
      lastMessageAt: ago(2 * H), lastMessagePreview: 'ভাই, কালকে যে productটা নিয়েছিলাম সেটা কাজ করছে না…',
      unreadCount: 2,
    },
  })
  const convAmitTg = await db.conversation.create({
    data: {
      businessId: business.id, partyId: amit.id, channel: 'telegram',
      externalId: 'tg-chat-amit-771',
      lastMessageAt: ago(26 * H), lastMessagePreview: 'Thanks! Payment করে দিয়েছি।',
      unreadCount: 0,
    },
  })
  const convSouravWa = await db.conversation.create({
    data: {
      businessId: business.id, partyId: sourav.id, channel: 'whatsapp',
      externalId: 'wa-thread-sourav-002',
      lastMessageAt: ago(5 * H), lastMessagePreview: 'পরে বাকি টাকা দিয়ে দেবো ভাই',
      unreadCount: 1,
    },
  })

  await db.message.createMany({
    data: [
      // Amit WhatsApp thread — includes the complaint-worthy message
      { businessId: business.id, conversationId: convAmitWa.id, partyId: amit.id, channel: 'whatsapp', direction: 'inbound', senderType: 'customer', body: 'ভাই, কালকে যে productটা নিয়েছিলাম সেটা কাজ করছে না।', externalMessageId: 'wa-msg-9001', createdAt: ago(3 * H), isRead: true, readAt: ago(3 * H) },
      { businessId: business.id, conversationId: convAmitWa.id, partyId: amit.id, channel: 'whatsapp', direction: 'outbound', senderType: 'staff', senderId: user.id, body: 'কোন প্রবলেম হচ্ছে বলুন তো? আমি দেখছি।', externalMessageId: 'wa-msg-9002', createdAt: ago(2.8 * H), isRead: true, readAt: ago(2.7 * H) },
      { businessId: business.id, conversationId: convAmitWa.id, partyId: amit.id, channel: 'whatsapp', direction: 'inbound', senderType: 'customer', body: 'চালের ব্যাগে ছেঁড়া ধরনের সমস্যা, আধা ব্যাগ নষ্ট। ছবি পাঠাচ্ছি।', externalMessageId: 'wa-msg-9003', createdAt: ago(2 * H) },
      { businessId: business.id, conversationId: convAmitWa.id, partyId: amit.id, channel: 'whatsapp', direction: 'internal_note', senderType: 'staff', senderId: user.id, body: 'Internal: সম্ভবত ট্রান্সপোর্ট ড্যামেজ। Replacement দিতে হবে।', externalMessageId: 'wa-msg-9004', createdAt: ago(1.9 * H) },
      // Amit Telegram thread
      { businessId: business.id, conversationId: convAmitTg.id, partyId: amit.id, channel: 'telegram', direction: 'inbound', senderType: 'customer', body: 'INV-1001 এর পেমেন্ট করে দিয়েছি, চেক করেন।', externalMessageId: 'tg-msg-5101', createdAt: ago(27 * H), isRead: true, readAt: ago(27 * H) },
      { businessId: business.id, conversationId: convAmitTg.id, partyId: amit.id, channel: 'telegram', direction: 'outbound', senderType: 'staff', senderId: user.id, body: 'Thanks! Payment কনফার্ম হয়েছে ✅', externalMessageId: 'tg-msg-5102', createdAt: ago(26 * H), isRead: true, readAt: ago(25 * H) },
      // Sourav WhatsApp thread
      { businessId: business.id, conversationId: convSouravWa.id, partyId: sourav.id, channel: 'whatsapp', direction: 'inbound', senderType: 'customer', body: 'ভাই একটু সময় দেন, পরে বাকি টাকা দিয়ে দেবো।', externalMessageId: 'wa-msg-9101', createdAt: ago(5 * H) },
    ],
  })
  console.log('conversations: 3, messages: 7')

  // ── 5. Complaints + events ──────────────────────────────────────────────
  await db.complaintSequence.upsert({
    where: { businessId: business.id },
    update: { nextNumber: 4 },
    create: { businessId: business.id, nextNumber: 4 },
  })
  const complaintA = await db.complaint.create({
    data: {
      businessId: business.id, complaintNumber: 'CMP-0001', partyId: amit.id,
      sourceType: 'MESSAGE', sourceId: 'wa-msg-9003',
      title: 'চালের ব্যাগ ছিঁড়ে গেছে (Damaged rice bag)',
      description: 'INV-1003 এর সাথে নেওয়া Premium Rice ব্যাগে ছেঁড়া — আধা ব্যাগ নষ্ট। WhatsApp এ ছবি পাঠিয়েছে।',
      status: 'NEW', priority: 'HIGH', assignedTo: user.id,
      relatedInvoiceId: invA3.id,
      internalNotes: JSON.stringify([{ note: 'সম্ভবত ট্রান্সপোর্ট ড্যামেজ — replacement এর কথা বলা হয়েছে।', author: user.id, createdAt: ago(1.8 * H).toISOString() }]),
    },
  })
  const complaintS = await db.complaint.create({
    data: {
      businessId: business.id, complaintNumber: 'CMP-0002', partyId: sourav.id,
      sourceType: 'CALL', sourceId: 'call-20261008-1045',
      title: 'ডিটারজেন্ট পাউডারে গন্ধের সমস্যা',
      description: 'কলে জানালো শেষ ব্যাচের Detergent Powder এ গন্ধ আগের মতো নেই।',
      status: 'IN_PROGRESS', priority: 'MEDIUM', assignedTo: user.id,
      relatedInvoiceId: invS1.id,
      internalNotes: JSON.stringify([{ note: 'Supplier এর সাথে কথা বলা হয়েছে, batch চেক করছি।', author: user.id, createdAt: ago(2 * D).toISOString() }]),
    },
  })
  const complaintR = await db.complaint.create({
    data: {
      businessId: business.id, complaintNumber: 'CMP-0003', partyId: rahul.id,
      sourceType: 'FEEDBACK', sourceId: null,
      title: 'বিস্কুটের প্যাকেজিং দুর্বল',
      description: 'Feedback এ ৩★ দিয়েছে — অনেকগুলো প্যাকেট ভাঙা অবস্থায় পেয়েছে।',
      status: 'RESOLVED', priority: 'LOW', assignedTo: user.id,
      relatedInvoiceId: invR1.id,
      resolution: 'নতুন করে ২ কার্টন পাঠানো হয়েছে, customer সন্তুষ্ট।',
      resolvedAt: ago(1 * D),
    },
  })
  await db.complaintEvent.createMany({
    data: [
      { businessId: business.id, complaintId: complaintA.id, eventType: 'CREATED', toValue: 'NEW', note: 'WhatsApp মেসেজ থেকে complaint তৈরি হয়েছে', actor: user.id, createdAt: ago(1.7 * H) },
      { businessId: business.id, complaintId: complaintA.id, eventType: 'ASSIGN', toValue: user.id, note: 'Assigned to owner', actor: user.id, createdAt: ago(1.6 * H) },
      { businessId: business.id, complaintId: complaintS.id, eventType: 'CREATED', toValue: 'NEW', note: 'কল রেকর্ড থেকে complaint', actor: user.id, createdAt: ago(3 * D) },
      { businessId: business.id, complaintId: complaintS.id, eventType: 'STATUS_CHANGE', fromValue: 'NEW', toValue: 'IN_PROGRESS', note: 'Supplier এর সাথে যোগাযোগ করা হয়েছে', actor: user.id, createdAt: ago(2 * D) },
      { businessId: business.id, complaintId: complaintR.id, eventType: 'CREATED', toValue: 'NEW', note: 'Product feedback থেকে escalate', actor: user.id, createdAt: ago(4 * D) },
      { businessId: business.id, complaintId: complaintR.id, eventType: 'RESOLVE', toValue: 'RESOLVED', note: 'Replacement পাঠানো হয়েছে', actor: user.id, createdAt: ago(1 * D) },
    ],
  })
  console.log('complaints: 3 (NEW / IN_PROGRESS / RESOLVED)')

  // ── 6. Behaviour + history ──────────────────────────────────────────────
  const behA = await db.customerBehaviour.upsert({
    where: { businessId_partyId: { businessId: business.id, partyId: amit.id } },
    update: { rating: 'BEST', tags: JSON.stringify(['Respectful', 'Regular customer', 'On-time payer']), notes: 'খুব ভালো customer, সবসময় সময়মতো পেমেন্ট করে।', ratedBy: user.id },
    create: { businessId: business.id, partyId: amit.id, rating: 'BEST', tags: JSON.stringify(['Respectful', 'Regular customer', 'On-time payer']), notes: 'খুব ভালো customer।', ratedBy: user.id },
  })
  const behS = await db.customerBehaviour.upsert({
    where: { businessId_partyId: { businessId: business.id, partyId: sourav.id } },
    update: { rating: 'GOOD', tags: JSON.stringify(['Regular customer', 'Price sensitive']), ratedBy: user.id },
    create: { businessId: business.id, partyId: sourav.id, rating: 'GOOD', tags: JSON.stringify(['Regular customer', 'Price sensitive']), ratedBy: user.id },
  })
  const behD = await db.customerBehaviour.upsert({
    where: { businessId_partyId: { businessId: business.id, partyId: defaulted.id } },
    update: { rating: 'VERY_BAD', tags: JSON.stringify(['Frequently delays payment', 'Aggressive']), notes: 'একাধিকবার প্রতিশ্রুতি ভঙ্গ, সাবধানে ডিল করুন।', ratedBy: user.id },
    create: { businessId: business.id, partyId: defaulted.id, rating: 'VERY_BAD', tags: JSON.stringify(['Frequently delays payment']), ratedBy: user.id },
  })
  await db.customerBehaviourHistory.createMany({
    data: [
      { businessId: business.id, partyId: amit.id, behaviourId: behA.id, rating: 'GOOD', tags: JSON.stringify(['Regular customer']), ratedBy: user.id, createdAt: ago(40 * D) },
      { businessId: business.id, partyId: amit.id, behaviourId: behA.id, rating: 'BETTER', tags: JSON.stringify(['Regular customer', 'On-time payer']), ratedBy: user.id, createdAt: ago(18 * D) },
      { businessId: business.id, partyId: amit.id, behaviourId: behA.id, rating: 'BEST', tags: JSON.stringify(['Respectful', 'Regular customer', 'On-time payer']), ratedBy: user.id, createdAt: ago(5 * D) },
      { businessId: business.id, partyId: sourav.id, behaviourId: behS.id, rating: 'GOOD', tags: JSON.stringify(['Regular customer', 'Price sensitive']), ratedBy: user.id, createdAt: ago(12 * D) },
      { businessId: business.id, partyId: defaulted.id, behaviourId: behD.id, rating: 'VERY_BAD', tags: JSON.stringify(['Frequently delays payment', 'Aggressive']), ratedBy: user.id, createdAt: ago(7 * D) },
    ],
  })
  console.log('behaviour: 3 ratings + 5 history rows')

  // ── 7. Reward cycles + events ───────────────────────────────────────────
  // Amit: cycle 1 REWARDED (412/400), cycle 2 UNLOCKED (400/400 → ready to give)
  const amitCycle1 = await db.customerRewardCycle.create({
    data: {
      businessId: business.id, partyId: amit.id, cycleNumber: 1, threshold: 400,
      accumulatedProfit: 412, status: 'REWARDED', startedAt: ago(20 * D),
      unlockedAt: ago(8 * D), rewardGivenAt: ago(7 * D), rewardDescription: '৳১০০ মূল্যের চাল (৫কেজি)',
    },
  })
  const amitCycle2 = await db.customerRewardCycle.create({
    data: {
      businessId: business.id, partyId: amit.id, cycleNumber: 2, threshold: 400,
      accumulatedProfit: 400, status: 'UNLOCKED', startedAt: ago(7 * D), unlockedAt: ago(2 * H),
    },
  })
  // Sourav: ACTIVE at 280/400
  const souravCycle = await db.customerRewardCycle.create({
    data: {
      businessId: business.id, partyId: sourav.id, cycleNumber: 1, threshold: 400,
      accumulatedProfit: 280, status: 'ACTIVE', startedAt: ago(15 * D),
    },
  })
  await db.customerRewardEvent.createMany({
    data: [
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle1.id, eventType: 'PROFIT_ACCRUAL', amount: 352, sourceInvoiceId: invA1.id, createdAt: ago(21 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle1.id, eventType: 'PROFIT_ACCRUAL', amount: 60, sourceInvoiceId: invA2.id, createdAt: ago(9 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle1.id, eventType: 'REWARD_UNLOCKED', amount: 412, note: '₹400 threshold reached', createdAt: ago(8 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle1.id, eventType: 'REWARD_GIVEN', note: '৳১০০ মূল্যের চাল (৫কেজি)', createdAt: ago(7 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle2.id, eventType: 'CYCLE_RESET', note: 'New cycle started after reward', createdAt: ago(7 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle2.id, eventType: 'PROFIT_ACCRUAL', amount: 250, sourceInvoiceId: invA3.id, createdAt: ago(2 * D) },
      { businessId: business.id, partyId: amit.id, cycleId: amitCycle2.id, eventType: 'REWARD_UNLOCKED', amount: 400, note: '₹400 threshold reached — reward ready', createdAt: ago(2 * H) },
      { businessId: business.id, partyId: sourav.id, cycleId: souravCycle.id, eventType: 'PROFIT_ACCRUAL', amount: 280, sourceInvoiceId: invS1.id, createdAt: ago(15 * D) },
    ],
  })
  console.log('reward cycles: 3 (REWARDED / UNLOCKED / ACTIVE) + 8 events')

  // ── 8. Product feedback ─────────────────────────────────────────────────
  const fbProduct = products[0]
  const fbProduct2 = products[1]
  if (fbProduct && fbProduct2) {
    await db.productFeedback.createMany({
      data: [
        { businessId: business.id, partyId: amit.id, invoiceId: invA1.id, productId: fbProduct.id, status: 'submitted', rating: 5, comment: 'খুব ভালো মান, আবার নেবো ইনশাআল্লাহ।', requestedAt: ago(19 * D), submittedAt: ago(18 * D), createdAt: ago(21 * D) },
        { businessId: business.id, partyId: rahul.id, invoiceId: invR1.id, productId: fbProduct2.id, status: 'submitted', rating: 3, comment: 'প্যাকেজিং আরো ভালো হওয়া দরকার।', requestedAt: ago(5 * D), submittedAt: ago(4 * D), createdAt: ago(6 * D) },
      ],
    })
  }

  // ── 9. Follow-ups + sequence + events ───────────────────────────────────
  await db.followUpSequence.upsert({
    where: { businessId: business.id },
    update: { nextNumber: 4 },
    create: { businessId: business.id, nextNumber: 4 },
  })
  const fuFeedback = await db.followUp.create({
    data: {
      businessId: business.id, followUpNumber: 'FU-0001', partyId: amit.id,
      type: 'product_feedback', sourceType: 'SYSTEM_CREATED',
      title: 'Amit Trading — INV-1002 প্রোডাক্ট ফিডব্যাক নিন',
      description: 'কেনার ৩ দিন পর ফিডব্যাক নিতে যোগাযোগ করুন।',
      status: 'PENDING', priority: 'MEDIUM', assignedToId: user.id, createdById: user.id,
      dueAt: ahead(6 * H), relatedInvoiceId: invA2.id,
    },
  })
  const fuComplaint = await db.followUp.create({
    data: {
      businessId: business.id, followUpNumber: 'FU-0002', partyId: amit.id,
      type: 'complaint_followup', sourceType: 'MANUAL',
      title: 'CMP-0001 ফলো-আপ — রিপ্লেসমেন্ট ঠিক হলো কিনা',
      status: 'PENDING', priority: 'HIGH', assignedToId: user.id, createdById: user.id,
      dueAt: ahead(1 * D), relatedComplaintId: complaintA.id,
    },
  })
  const fuPayment = await db.followUp.create({
    data: {
      businessId: business.id, followUpNumber: 'FU-0003', partyId: sourav.id,
      type: 'payment_reminder', sourceType: 'MANUAL',
      title: 'Sourav Stores — ₹12,800 বাকি টাকার রিমাইন্ডার',
      description: 'WhatsApp এ রিমাইন্ডার পাঠানো হয়েছে, কথা বলুন।',
      status: 'IN_PROGRESS', priority: 'HIGH', assignedToId: user.id, createdById: user.id,
      dueAt: ago(2 * H),
    },
  })
  await db.followUpEvent.createMany({
    data: [
      { businessId: business.id, followUpId: fuFeedback.id, eventType: 'CREATED', toValue: 'PENDING', note: 'System created after INV-1002', actor: 'system', createdAt: ago(9 * D) },
      { businessId: business.id, followUpId: fuComplaint.id, eventType: 'CREATED', toValue: 'PENDING', note: 'Complaint CMP-0001 থেকে', actor: user.id, createdAt: ago(1 * H) },
      { businessId: business.id, followUpId: fuPayment.id, eventType: 'CREATED', toValue: 'PENDING', actor: user.id, createdAt: ago(2 * D) },
      { businessId: business.id, followUpId: fuPayment.id, eventType: 'STATUS_CHANGE', fromValue: 'PENDING', toValue: 'IN_PROGRESS', note: 'রিমাইন্ডার পাঠানো হয়েছে', actor: user.id, createdAt: ago(5 * H) },
    ],
  })

  // ── 10. Party note ──────────────────────────────────────────────────────
  const existingNotes = await db.partyNote.count({ where: { partyId: amit.id } })
  if (existingNotes === 0) {
    await db.partyNote.create({
      data: {
        partyId: amit.id, type: 'general',
        content: 'Customer prefers WhatsApp. Usually orders monthly. Morning calls preferred.',
        author: user.id,
      },
    })
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const counts = {
    users: await db.user.count(),
    invoices: await db.invoice.count(),
    conversations: await db.conversation.count(),
    messages: await db.message.count(),
    complaints: await db.complaint.count(),
    complaintEvents: await db.complaintEvent.count(),
    behaviour: await db.customerBehaviour.count(),
    behaviourHistory: await db.customerBehaviourHistory.count(),
    rewardCycles: await db.customerRewardCycle.count(),
    rewardEvents: await db.customerRewardEvent.count(),
    productFeedback: await db.productFeedback.count(),
    followups: await db.followUp.count(),
    followupEvents: await db.followUpEvent.count(),
    notes: await db.partyNote.count(),
    channelIdentities: await db.customerChannelIdentity.count(),
  }
  console.log('FINAL COUNTS:', JSON.stringify(counts, null, 2))
  console.log('LOGIN: owner@bizledger.test / Test@1234')
}

main()
  .catch((e) => { console.error('FAILED:', e); process.exit(1) })
  .finally(() => db.$disconnect())
