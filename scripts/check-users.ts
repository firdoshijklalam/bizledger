import { db } from '/home/z/my-project/src/lib/db'
async function main() {
  const users = await db.user.findMany({ select: { email: true, role: true, businessId: true } })
  console.log('Users:', JSON.stringify(users, null, 2))
  const businesses = await db.business.findMany({ select: { id: true, name: true } })
  console.log('Businesses:', JSON.stringify(businesses, null, 2))
}
main().catch(console.error).finally(() => db.$disconnect())
