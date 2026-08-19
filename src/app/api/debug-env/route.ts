import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({
    URL_set: !!process.env.UPSTASH_REDIS_REST_URL,
    TOKEN_set: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    URL_len: process.env.UPSTASH_REDIS_REST_URL?.length || 0,
    TOKEN_len: process.env.UPSTASH_REDIS_REST_TOKEN?.length || 0,
  })
}
