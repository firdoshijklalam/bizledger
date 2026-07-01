import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/products/ai-autofill — AI auto-fill product data from an uploaded image (PRD Part 35 §1.2).
// Body: { image: "data:image/jpeg;base64,..." }
// Returns: { ok: true, data: { name, category, subCategory, mrp, gstRate, description, brand, unit } }
// Always returns 200 (with a fallback object) so the frontend can keep working even if VLM fails.

const PROMPT = `You are a product identification AI for Indian retail. Analyze this product image and extract:
1. Product name (brand + variant, e.g. "Tata Salt 1kg")
2. Category (standard Indian retail category: Grocery, Electronics, Construction, etc.)
3. Sub-category (if identifiable, e.g. "Salt", "Basmati Rice")
4. MRP (Maximum Retail Price in ₹, look for ₹ symbol on packaging)
5. GST rate (standard Indian GST: 0% for unbranded food, 5% for branded food, 12% or 18% for others)
6. Professional description (1-2 sentences, e-commerce style)
7. Brand name
8. Unit/weight (e.g. "1 kg", "500 gm", "1 L")

Return ONLY valid JSON (no markdown):
{
  "name": "string",
  "category": "string",
  "subCategory": "string",
  "mrp": number,
  "gstRate": number,
  "description": "string",
  "brand": "string",
  "unit": "string"
}`

// Fallback used whenever the VLM call fails or returns un-parseable JSON,
// so the demo flow keeps working without a real VLM success.
const FALLBACK_DATA = {
  name: 'Detected Product',
  category: 'Grocery',
  subCategory: '',
  mrp: 0,
  gstRate: 5,
  description: 'Product detected via AI vision. Please verify and edit details.',
  brand: '',
  unit: 'pcs',
}

// Best-effort JSON extraction from a VLM text response.
// Handles markdown code fences and stray surrounding prose.
function parseVlmJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    const match = text.match(/\{[\s\S]*\}/)
    return JSON.parse(match ? match[0] : text)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const imageDataUrl: string | undefined = body.image
    if (!imageDataUrl) {
      // Still return 200 with the fallback so the UI keeps working.
      return NextResponse.json({ ok: true, data: FALLBACK_DATA, source: 'fallback-no-image' })
    }

    let parsed: Record<string, unknown> | null = null

    try {
      const zai = await ZAI.create()
      const response = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      })

      const content: string = response.choices?.[0]?.message?.content || ''
      parsed = parseVlmJson(content)
    } catch (vlmErr) {
      console.error('AI autofill VLM error:', vlmErr)
      parsed = null
    }

    // If VLM succeeded but returned invalid JSON (or threw), use the fallback.
    if (!parsed) {
      return NextResponse.json({ ok: true, data: FALLBACK_DATA, source: 'fallback' })
    }

    // Normalize the parsed payload to the expected shape with safe defaults.
    const data = {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : FALLBACK_DATA.name,
      category:
        typeof parsed.category === 'string' && parsed.category ? parsed.category : FALLBACK_DATA.category,
      subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : '',
      mrp: typeof parsed.mrp === 'number' && !Number.isNaN(parsed.mrp) ? parsed.mrp : 0,
      gstRate: typeof parsed.gstRate === 'number' && !Number.isNaN(parsed.gstRate) ? parsed.gstRate : 5,
      description:
        typeof parsed.description === 'string' && parsed.description
          ? parsed.description
          : FALLBACK_DATA.description,
      brand: typeof parsed.brand === 'string' ? parsed.brand : '',
      unit: typeof parsed.unit === 'string' && parsed.unit ? parsed.unit : 'pcs',
    }

    return NextResponse.json({ ok: true, data, source: 'vlm' })
  } catch (e) {
    // Never error out — always return 200 with the fallback so the UI keeps working.
    console.error('AI autofill error:', e)
    return NextResponse.json({ ok: true, data: FALLBACK_DATA, source: 'fallback-error' })
  }
}
