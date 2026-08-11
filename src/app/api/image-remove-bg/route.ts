import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api-error'

// POST /api/image-remove-bg — remove background from product image
// In production, this would use remove.bg API. Here we use a placeholder approach.
// Body: { image: "data:image/jpeg;base64,..." }
export async function POST(req: NextRequest) {
  try {
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
