import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { apiError } from '@/lib/api-error'

// POST /api/ocr — scan a bill/receipt image and extract structured data using VLM
// Body: { image: "data:image/jpeg;base64,..." }
// Returns: { vendor, date, items: [{name, qty, price, total}], subtotal, tax, grandTotal }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const image = body.image
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const zai = await ZAI.create()

    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an OCR scanner for business bills/receipts. Analyze this bill image and extract structured data.
Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "vendor": "shop/supplier name",
  "date": "DD/MM/YYYY or null",
  "invoiceNumber": "bill number or null",
  "items": [
    { "name": "item name", "qty": number, "price": number, "total": number }
  ],
  "subtotal": number,
  "tax": number,
  "grandTotal": number
}
If a field is not visible, use null or 0. For items, extract every line item visible. Quantities and prices must be numbers.`,
            },
            {
              type: 'image_url',
              image_url: { url: image },
            },
          ],
        },
      ],
    } as any)

    const content = response.choices[0]?.message?.content || ''

    // Extract JSON from response (handle markdown code blocks)
    let parsed
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content)
    } catch {
      parsed = { rawResponse: content, items: [] }
    }

    return NextResponse.json({ success: true, data: parsed })
  } catch (e) {
    console.error('OCR error:', e)
    return apiError(e, "OCR processing failed")
  }
}
