import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/products/ai-autofill — AI auto-fill product data from an uploaded image (PRD Part 35 §1.2).
// Pipeline: 1) VLM OCR reads packaging text → 2) Web search enriches with official description/MRP/GST.
// Body: { image: "data:image/jpeg;base64,..." }
// Returns: { ok: true, data: { name, category, subCategory, mrp, gstRate, description, brand, unit }, source }
// Always returns 200 (with a fallback object) so the frontend keeps working even if VLM fails.

const OCR_PROMPT = `You are a product identification AI for Indian retail. Analyze this product image and extract ONLY what is visible on the packaging:
1. Product name (brand + variant, e.g. "Tata Salt 1kg")
2. Any visible text on the packet (brand name, weight, MRP, ingredients, etc.)
3. Category guess (standard Indian retail: Grocery, Electronics, Construction, etc.)
4. Sub-category (if identifiable, e.g. "Salt", "Basmati Rice")
5. MRP if visible (look for ₹ symbol)
6. Unit/weight if visible (e.g. "1 kg", "500 gm", "1 L")

Return ONLY valid JSON (no markdown):
{
  "name": "string",
  "category": "string",
  "subCategory": "string",
  "mrp": number,
  "unit": "string",
  "brand": "string",
  "rawText": "all visible text on packaging"
}`

const ENRICHMENT_PROMPT = (ocrData: any) => `You are a product database AI. Based on this OCR data from a product image, find the OFFICIAL product details by searching the internet.

OCR Data: ${JSON.stringify(ocrData)}

Use web search to find the official:
1. Professional product description (1-2 sentences, e-commerce style)
2. Correct MRP (if OCR didn't capture it)
3. Standard GST rate for this product category in India (0% unbranded food, 5% branded food, 12% or 18% others)
4. Confirm/fix the product name and brand

Return ONLY valid JSON:
{
  "name": "corrected product name",
  "category": "confirmed category",
  "subCategory": "confirmed sub-category",
  "mrp": number,
  "gstRate": number,
  "description": "professional e-commerce description",
  "brand": "brand name",
  "unit": "unit/weight"
}`

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

function parseVlmJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    const match = text.match(/\{[\s\S]*\}/)
    return JSON.parse(match ? match[0] : text)
  } catch {
    return null
  }
}

function normalizeData(parsed: Record<string, unknown> | null) {
  if (!parsed) return null
  return {
    name: typeof parsed.name === 'string' && parsed.name ? parsed.name : FALLBACK_DATA.name,
    category: typeof parsed.category === 'string' && parsed.category ? parsed.category : FALLBACK_DATA.category,
    subCategory: typeof parsed.subCategory === 'string' ? parsed.subCategory : '',
    mrp: typeof parsed.mrp === 'number' && !Number.isNaN(parsed.mrp) ? parsed.mrp : 0,
    gstRate: typeof parsed.gstRate === 'number' && !Number.isNaN(parsed.gstRate) ? parsed.gstRate : 5,
    description: typeof parsed.description === 'string' && parsed.description ? parsed.description : FALLBACK_DATA.description,
    brand: typeof parsed.brand === 'string' ? parsed.brand : '',
    unit: typeof parsed.unit === 'string' && parsed.unit ? parsed.unit : 'pcs',
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const imageDataUrl: string | undefined = body.image
    if (!imageDataUrl) {
      return NextResponse.json({ ok: true, data: FALLBACK_DATA, source: 'fallback-no-image' })
    }

    let ocrData: Record<string, unknown> | null = null
    let enrichedData: Record<string, unknown> | null = null

    // Step 1: VLM OCR — read text from the product image
    try {
      const zai = await ZAI.create()
      const vlmResponse = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: OCR_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      } as any)

      const ocrText: string = vlmResponse.choices?.[0]?.message?.content || ''
      ocrData = parseVlmJson(ocrText)
    } catch (vlmErr) {
      console.error('AI autofill VLM error:', vlmErr)
      ocrData = null
    }

    // Step 2: Web search enrichment — find official description/MRP/GST using OCR data
    if (ocrData) {
      try {
        const zai = await ZAI.create()
        const enrichResponse = await zai.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: ENRICHMENT_PROMPT(ocrData),
            },
          ],
          functions: ['web_search'],
        } as any)

        const enrichText: string = enrichResponse.choices?.[0]?.message?.content || ''
        enrichedData = parseVlmJson(enrichText)
      } catch (enrichErr) {
        console.error('AI autofill web search enrichment error:', enrichErr)
        enrichedData = null
      }
    }

    // Merge: prefer enriched data, fall back to OCR data, then to FALLBACK
    const finalData = normalizeData(enrichedData) || normalizeData(ocrData) || FALLBACK_DATA

    const source = enrichedData ? 'vlm+web' : ocrData ? 'vlm' : 'fallback'
    return NextResponse.json({ ok: true, data: finalData, source })
  } catch (e) {
    console.error('AI autofill error:', e)
    return NextResponse.json({ ok: true, data: FALLBACK_DATA, source: 'fallback-error' })
  }
}
