/**
 * §AUTH-SEED: Creates a default OWNER user for the existing business.
 * Run this once to set up the first login account.
 *
 * Usage: npx tsx scripts/seed-auth-user.ts
 *
 * Default credentials:
 *   Email: owner@bizledger.app
 *   Password: admin123
 *
 * CHANGE THE PASSWORD IMMEDIATELY after first login!
 */
import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth/session'

async function main() {
  const business = await db.business.findFirst({
    where: { name: 'Sharma Trading Co.' },
  })
  if (!business) {
    console.error('No business found. Run the seed script first.')
    process.exit(1)
  }

  // Check if user already exists
  const existing = await db.user.findUnique({
    where: { email: 'owner@bizledger.app' },
  })
  if (existing) {
    console.log('✅ Owner user already exists:')
    console.log('   Email: owner@bizledger.app')
    console.log('   Business:', business.name)
    process.exit(0)
  }

  const passwordHash = hashPassword('admin123')

  const user = await db.user.create({
    data: {
      email: 'owner@bizledger.app',
      passwordHash,
      name: business.ownerName || 'Owner',
      role: 'OWNER',
      businessId: business.id,
    },
  })

  console.log('✅ Owner user created successfully!')
  console.log('   Email: owner@bizledger.app')
  console.log('   Password: admin123')
  console.log('   Role: OWNER')
  console.log('   Business:', business.name)
  console.log('')
  console.log('⚠️  CHANGE THE PASSWORD IMMEDIATELY after first login!')

  // §BIOMETRIC-SEED: register a "primary" fingerprint record for the business
  // so the biometric gates (Inventory Price Modification, Wholesale Reveal,
  // Discount, etc.) are testable in dev. The gate's biometric path has a demo
  // fallback that accepts any registered role='primary' fingerprint when no
  // specific fingerprintHash is presented (see /api/biometric/gate route).
  // Without this record, every "Simulate Fingerprint Scan" fails and the gate
  // locks down after repeated attempts.
  const existingFp = await db.fingerprintRecord.findFirst({
    where: { businessId: business.id, role: 'primary' },
  })
  if (!existingFp) {
    await db.fingerprintRecord.create({
      data: {
        fingerprintHash: `dev-seed-${business.id}-${Date.now()}`,
        businessId: business.id,
        hand: 'right',
        finger: 'thumb',
        role: 'primary',
        linkedName: 'Owner (dev seed)',
        scannerType: 'native',
      },
    })
    console.log('👍 Seeded a primary fingerprint record (biometric gates now testable in dev)')
  } else {
    console.log('👍 Primary fingerprint record already present')
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
