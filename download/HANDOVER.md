# BizLedger — Project Handover Document

## 📋 Project Overview
BizLedger হলো একটি mobile-first, multi-module business management platform — Indian traders-দের জন্য ডিজিটাল খাতা, ইনভেন্টরি, বিলিং, GST ও রিপোর্টস সহ। Next.js 16 + Prisma + Zustand দিয়ে তৈরি।

---

## 🛠️ Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Database | SQLite via Prisma 6 (dev), Neon PG (prod Phase 3) |
| State | Zustand 5 (app-store, i18n-store, billing-store, notification-store) |
| UI | Shadcn/UI + Radix + Tailwind CSS 4 |
| Charts | Recharts 2 |
| Animation | Framer Motion 12 |
| Icons | Lucide React |
| AI | z-ai-web-dev-sdk (VLM for OCR) |
| Auth | NextAuth.js v4 (available, not yet wired) |
| Runtime | Bun |
| Proxy | Caddy |

---

## 🚀 How to Run
```bash
# Install dependencies
bun install

# Push database schema
bun run db:push

# Start dev server (port 3000)
bun run dev

# Lint check
bun run lint

# Reset demo data
curl -X POST http://localhost:3000/api/reset
```

---

## 📁 Project Structure
```
src/
├── app/
│   ├── api/              # 28 API routes
│   │   ├── app-settings/ # Settings persist
│   │   ├── backup/       # Telegram + Drive backup
│   │   ├── biometric/    # Fingerprint register/recognize
│   │   ├── business/     # Business profile CRUD
│   │   ├── dashboard/    # Dashboard stats (with ?range= param)
│   │   ├── data-export/  # JSON/CSV export
│   │   ├── forecast/     # Demand prediction
│   │   ├── grade-recalculate/ # AI grade recalc
│   │   ├── image-remove-bg/ # remove.bg stub
│   │   ├── insights/     # Business insights
│   │   ├── invoices/     # Invoice CRUD + [id]
│   │   ├── ocr/          # VLM bill scanner
│   │   ├── parties/      # Party CRUD + [id] + categories
│   │   ├── payment/      # Public payment landing page data
│   │   ├── pin/          # App PIN set/verify
│   │   ├── products/     # Product CRUD + [id] + restock + categories
│   │   ├── reminders/    # Overdue payment reminders
│   │   ├── reports/      # All report types
│   │   ├── reset/        # Reset demo data
│   │   ├── seed/         # Seed demo data
│   │   └── transactions/ # Transaction CRUD
│   ├── globals.css       # BizLedger theme (emerald green)
│   ├── layout.tsx        # Root layout + ThemeProvider + SW registration
│   └── page.tsx          # AppShell (single-page app)
├── components/
│   ├── layout/           # TopAppBar, BottomTabNav, SideDrawerFab, SearchOverlay, GlobalVoiceInput
│   ├── shared/           # FullScreenPicker, FloatingInvoiceModal, CategoryProductPicker, States
│   ├── ui/               # Shadcn/UI components (60+)
│   └── views/
│       ├── ai/           # ForecastView, InsightsView, RemindersView, OcrScannerView
│       ├── billing/      # InvoiceForm, InvoicePreview, BillingTabs
│       ├── inventory/    # ProductForm, ProductProfile
│       ├── khata/        # PartyForm, PartyDetail, TransactionForm
│       ├── dashboard-view.tsx
│       ├── khata-view.tsx
│       ├── inventory-view.tsx
│       ├── billing-view.tsx
│       ├── reports-view.tsx
│       ├── settings-view.tsx
│       ├── notifications-view.tsx
│       ├── ai-tools-view.tsx
│       ├── sale-pad-view.tsx
│       └── payment-landing-page.tsx
├── hooks/
│   ├── use-back-button.ts    # Android back navigation
│   ├── use-fetch.ts          # Data fetching with refreshKey
│   ├── use-long-press.ts     # Long-press multi-select
│   ├── use-mounted.ts        # SSR-safe mounted check
│   ├── use-scroll-retention.ts # Scroll position save/restore
│   └── use-voice-input.ts    # Web Speech API + entity parsing
├── lib/
│   ├── db.ts                 # Prisma client
│   ├── grade-calculator.ts   # AI grading algorithm
│   ├── phonetic.ts           # Bengali↔English sound matching
│   ├── types.ts              # All TypeScript types
│   ├── utils.ts              # Currency, date, grade utilities
│   └── voice-parser.ts       # Voice entity extraction
├── store/
│   ├── app-store.ts          # Main navigation + state
│   ├── billing-store.ts      # Multi-tab billing drafts (localStorage)
│   ├── i18n-store.ts         # EN/BN/HI translations
│   └── notification-store.ts # Notification types + deep-links
└── prisma/
    └── schema.prisma         # 11 models
```

---

## 🗄️ Database Models (11)
1. **Business** — name, phone, gstin, upiId, currency
2. **Party** — name, phone, type, balance, qualityGrade, creditLimit, retailEnabled
3. **Product** — name, sku, category, prices, stock, retailEnabled, retailUnit, retailRate
4. **ProductImage** — multi-image gallery
5. **Transaction** — type, amount, partyId, invoiceId
6. **Invoice** — invoiceNumber, items, GST, discount, paymentLandingToken
7. **InvoiceItem** — quantity, unitPrice, discount, gstRate, total
8. **PartyNote** — call/meeting/payment_promise/general
9. **AppSettings** — language, dateFormat, invoicePrefix, pinEnabled, userRole, biometricEnabled
10. **FingerprintRecord** — fingerprintHash, partyId (no raw biometric)
11. **BackupLog** — channel (telegram/drive), status, fileSize

---

## ✅ Implemented Features (PRD Part 1-7)

### Phase 1 (Core)
- Dashboard with 6 metric cards + sales trend chart
- Khata/Ledger — party CRUD, transactions, settle up, grade badges
- Inventory — product CRUD, stock alerts, category autocomplete, supplier linking
- Billing — invoice form with dual-mode discount, GST, payment modes, premium invoice preview
- Reports — P&L, GST, Party Ledger, Outstanding, Stock Ageing, Customer Quality
- Settings — Business Profile, Preferences (3 languages), Data Export, Security
- Bengali terms (পাবো/দেবো/বাকি আছে)
- Side-Drawer FAB with 5 quick actions
- Global search overlay
- Dark mode + 3-language toggle (EN/বাংলা/हिन्दी)

### Phase 2 (Enhanced)
- Grade auto-calculation (Payment Speed 35%, Outstanding Ratio 30%, Discount 20%, Tx Count 15%)
- Multi-tab billing hold system (localStorage persist, yellow dot indicators)
- WhatsApp + SMS share in invoice preview
- Payment Landing Page (?payment=TOKEN — UPI QR + Pay Now deep link)
- Notification deep-link navigation
- Quick Sale Pad (খুচরো/পূর্ণ জিনিস dual mode, category slider, cart)
- Dashboard multi-chart (6 types: Revenue, Profit, Cashflow, Collections, Categories, Inventory)
- Dynamic time-frame (10 options: 1d to 1y + Custom Date Range)
- Chart View Toggle (Line ↔ Bar)
- Dynamic X-axis labels (hours/dates/weeks/months based on range)
- Category-based hybrid product selection
- Cross-language phonetic search (Bengali↔English sound matching)
- Voice entity parsing (amount, customer, item, type extraction)
- Retail unit & rate config in product form

### Phase 3 (SaaS Scale)
- PWA (manifest.json + service worker)
- Telegram Bot backup API
- Google Drive backup API
- Cloud Restore (backup list + view)
- App PIN (4-6 digit, SHA-256 hash)
- Biometric fingerprint (register/recognize)
- RBAC roles (owner/manager/sales)
- Hindi (हिन्दी) translation
- remove.bg API stub
- Multi-tenant schema (FingerprintRecord, BackupLog models)

### Part 2-3 (UX Upgrades)
- Product Profile View (gallery, highlights, Restock/Edit/Delete buttons)
- Restock feature (quick-add +10/+25/+50/+100)
- Inventory clean cards (no edit/delete on main list)
- Add Party/Add Product buttons moved to top
- Address label fixed ("Address" not "Shop address")
- Grade hidden for Supplier type
- Interactive grade distribution bar chart (clickable → floating modal)
- Floating modal with "Go to Khata" shortcut
- Back-stack fix (returnToView — back returns to source screen)
- Android back button navigation

### Part 4 (Dashboard Analytics)
- Chart View Toggle (Line ↔ Bar)
- 10 time-frame options + Custom Date Range picker
- Dynamic X-axis timeline sync
- Collections vs New Credit chart
- Top Category & Product Sales (pie chart)
- Inventory Value Trend graph

### Part 5 (Navigation Fixes)
- Interactive bar chart for grade distribution
- Floating modal (no page redirect on grade click)
- Back-stack fix (Top Debtors → Profile → Back → Dashboard)
- Recent Transactions back-stack fix
- Global navigation rule (returnToView)

### Part 6 (Profile Actions)
- Quick Sale button replaces New Invoice in party profile
- Single transaction share via WhatsApp
- Bulk "Share Statement" via WhatsApp
- Invoices clickable with preview
- AI grading rules (A-E auto-calculated)
- Internal Notes privacy guard

### Part 7 (Advanced UX)
- Global state sync (refreshKey auto-refetch)
- Universal floating invoice modal (no page redirect)
- Scroll position retention
- Long-press multi-selection mode
- Select All / Deselect All bulk controls
- Share Selected transactions

---

## 🔧 Key Architecture Decisions

1. **Single-page app** — Zustand `activeView` controls navigation (no URL routing except `?payment=TOKEN`)
2. **Global state** — `refreshKey` in app-store triggers all `useFetch` hooks to refetch
3. **returnToView** — Tracks source screen for correct back navigation
4. **Portal-based pickers** — `FullScreenPicker` and `CategoryProductPicker` use `createPortal` to escape Radix Dialog focus trap
5. **Billing drafts** — `billing-store.ts` with Zustand `persist` middleware for localStorage
6. **i18n** — 3 dictionaries (en/bn/hi) with 130+ keys each
7. **Grade calculation** — `lib/grade-calculator.ts` with weighted scoring, auto-triggered on transaction/invoice creation

---

## ⚠️ Known Limitations
1. **Multi-tenant SaaS** — Schema ready but single-tenant only (one Business per DB)
2. **Telegram/Drive backup** — API stubs that log to DB; real Bot API/Drive API needs env vars
3. **Biometric** — Simulated hash; real fingerprint scanner SDK needed for production
4. **remove.bg** — Stub; needs `REMOVE_BG_API_KEY` env var
5. **Voice input** — Web Speech API works in Chrome/Edge; limited in other browsers
6. **NextAuth** — Installed but not wired; login page not built
7. **Hindi translation** — Complete but some less-used keys may fallback to English

---

## 🔑 Environment Variables
```
DATABASE_URL=file:/home/z/my-project/db/custom.db
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=https://your-domain.com
# Phase 3 (optional):
NEON_API_KEY=<neon-api-key>
REMOVE_BG_API_KEY=<remove-bg-key>
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHANNEL_ID=<channel-id>
GOOGLE_CLIENT_ID=<google-oauth-id>
GOOGLE_CLIENT_SECRET=<google-oauth-secret>
```

---

## 📝 For Z.ai — Maintenance Guide

### Adding a new view
1. Create `src/components/views/new-view.tsx`
2. Add to `ViewId` type in `src/lib/types.ts`
3. Add to `renderView()` in `src/components/layout/app-shell.tsx`
4. Add title to `VIEW_TITLES` in `src/components/layout/top-app-bar.tsx`

### Adding a new API
1. Create `src/app/api/endpoint-name/route.ts`
2. Use `import { db } from '@/lib/db'` for database access
3. Use `const business = await db.business.findFirst()` to get current business

### Adding a new translation key
1. Add to `en`, `bn`, `hi` dictionaries in `src/store/i18n-store.ts`
2. Use `const { t } = useI18n()` and `t('key.name')` in components

### Triggering global refresh
```typescript
const { triggerRefresh } = useAppStore()
triggerRefresh() // All useFetch hooks refetch
```

### Resetting demo data
```bash
curl -X POST http://localhost:3000/api/reset
```

---

## 📊 Final Statistics
- **80** React components
- **28** API endpoints
- **11** Prisma models
- **8** custom hooks
- **4** Zustand stores
- **6** lib utilities
- **3** languages (EN/বাংলা/हिन्दी)
- **0** lint errors
- **0** console errors

---

*Generated: June 2026 · BizLedger v4.0 · PRD Part 1-7 Complete*
