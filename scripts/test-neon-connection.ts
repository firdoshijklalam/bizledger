import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const count = await db.business.count()
  console.log('Businesses:', count)
  const users = await db.user.findMany({ select: { email: true, businessId: true } })
  console.log('Users:', JSON.stringify(users))
}
main().catch(console.error).finally(() => db.$disconnect())
