import { NextRequest, NextResponse } from 'next/server'
import { getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { checkRateLimit, getClientId, RATE_LIMITS } from '@/lib/rate-limit'

// §VERCEL-LIMIT: Allow up to 30s for AI background removal
export const maxDuration = 30

// POST /api/image-remove-bg — remove background from product image
// In production, this would use remove.bg API. Here we use a placeholder approach.
// Body: { image: "data:image/jpeg;base64,..." }
// §AUTH: Requires an authenticated business (any role) — background removal is a
// merchant-side catalog image operation tied to the business.
export async function POST(req: NextRequest) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // §RATE-LIMIT: 10 image-processing requests per minute per user.
    const clientId = getClientId(req, business.id)
    const rateResult = await checkRateLimit(
      clientId,
      RATE_LIMITS.IMAGE.name,
      RATE_LIMITS.IMAGE.limit,
      RATE_LIMITS.IMAGE.window
    )
    if (!rateResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateResult.reset / 1000) || 60),
            'X-RateLimit-Limit': String(rateResult.limit),
            'X-RateLimit-Remaining': String(rateResult.remaining),
          },
        }
      )
    }

    const body = await req.json()
    const image = body.image
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    // In production with REMOVE_BG_API_KEY:
    // const formData = new FormData()
    // formData.append('image_file', blob)
    // formData.append('size', 'auto')
    // const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    //   method: 'POST',
    //   headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY! },
    //   body: formData,
    // })
    // const result = await res.blob()
    // return NextResponse.json({ success: true, image: dataUrl })

    // Simulated response — return the original image as-is with a message
    return NextResponse.json({
      success: false,
      message: 'Background removal requires REMOVE_BG_API_KEY. Set it in .env to enable.',
      image: image, // Return original as fallback
    })
  } catch (e) {
    return apiError(e, "Image processing failed")
  }
}
