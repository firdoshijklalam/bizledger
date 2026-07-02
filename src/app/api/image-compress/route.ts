import { NextRequest, NextResponse } from 'next/server'

// PRD Part 37 §1.2 — Local Mode image compression (GLM 5.2 simulated).
// POST /api/image-compress
//   Body: { image: 'data:image/jpeg;base64,...', targetSizeKB?: number }
//   Logic:
//     1. Accept base64 image data URL.
//     2. Estimate original size: base64 string length * 0.75 / 1024 = KB.
//     3. If already under targetSizeKB (default 200), return as-is.
//     4. Otherwise, simulate compression (production would use sharp/canvas).
//        compressedSizeKB = min(originalSizeKB, targetSizeKB) with a realistic ratio.
//     5. Return { ok, originalSizeKB, compressedSizeKB, compressionRatio, image }.

const DEFAULT_TARGET_KB = 200

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image: string
      targetSizeKB?: number
    }

    if (!body.image || typeof body.image !== 'string') {
      return NextResponse.json(
        { error: 'image (data URL) is required' },
        { status: 400 }
      )
    }

    // Validate that it looks like a data URL.
    const dataUrlMatch = body.image.match(/^data:([^;]+);base64,(.*)$/)
    if (!dataUrlMatch) {
      return NextResponse.json(
        { error: 'image must be a base64 data URL (e.g. data:image/jpeg;base64,...)' },
        { status: 400 }
      )
    }

    const base64Payload = dataUrlMatch[2]
    const targetSizeKB = body.targetSizeKB && body.targetSizeKB > 0
      ? body.targetSizeKB
      : DEFAULT_TARGET_KB

    // Estimate original binary size from base64 length (4 chars = 3 bytes).
    const originalBytes = Math.floor((base64Payload.length * 3) / 4)
    const originalSizeKB = Math.round((originalBytes / 1024) * 100) / 100

    if (originalSizeKB <= targetSizeKB) {
      // Already small enough — return as-is.
      return NextResponse.json({
        ok: true,
        originalSizeKB,
        compressedSizeKB: originalSizeKB,
        compressionRatio: 1,
        image: body.image,
        skipped: true,
        message: 'Image already under target size; no compression needed.',
      })
    }

    // Simulate compression: in production this would re-encode the JPEG at a
    // lower quality / smaller dimension using sharp or canvas. For the demo we
    // apply a realistic compression ratio that lands at or just under the target.
    // Compression ratio = original / compressed.
    const targetSizeBytes = targetSizeKB * 1024
    // Apply a realistic 60% reduction, then clamp to target.
    const simulatedCompressedBytes = Math.min(
      Math.floor(originalBytes * 0.4), // ~60% reduction
      targetSizeBytes
    )
    const compressedSizeKB =
      Math.round((simulatedCompressedBytes / 1024) * 100) / 100
    const compressionRatio =
      Math.round((originalSizeKB / compressedSizeKB) * 100) / 100

    // In production: re-encode and return the new data URL. For the simulation,
    // we return the original data URL so the UI can still render it; the
    // compressedSizeKB reflects what the production compressor would yield.
    return NextResponse.json({
      ok: true,
      originalSizeKB,
      compressedSizeKB,
      compressionRatio,
      image: body.image,
      skipped: false,
      message: `Image compressed from ${originalSizeKB}KB to ~${compressedSizeKB}KB (${compressionRatio}x ratio).`,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
