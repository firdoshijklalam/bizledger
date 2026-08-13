import { NextResponse } from 'next/server'

// Temporary debug endpoint to verify environment variables are accessible.
// This will be deleted after verification.
export async function GET() {
  return NextResponse.json({
    UPSTASH_REDIS_REST_URL_set: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN_set: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    UPSTASH_REDIS_REST_URL_length: process.env.UPSTASH_REDIS_REST_URL?.length || 0,
    UPSTASH_REDIS_REST_TOKEN_length: process.env.UPSTASH_REDIS_REST_TOKEN?.length || 0,
    NODE_ENV: process.env.NODE_ENV,
  })
}
