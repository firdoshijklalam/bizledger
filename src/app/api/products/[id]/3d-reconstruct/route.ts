// PRD Part 34 §1 — 3D Reconstruction ingest endpoint.
// POST: ingest raw media (images or video) and run simulated GLM 5.2 Vision
// pipeline (bg removal → ironing → text restore → mesh gen → guardrail check).
// GET: return the latest media asset for the product.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Bounded random score in [min, max] with 1 decimal precision
function boundedRandom(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const latest = await db.productMediaAsset.findFirst({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ asset: latest })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const inputType: 'image' | 'video' = body.inputType === 'video' ? 'video' : 'image'
    const images: string[] = Array.isArray(body.images) ? body.images : []
    const videoFrames: string[] = Array.isArray(body.videoFrames) ? body.videoFrames : []
    const options = body.options ?? {}
    const bgRemoval = options.bgRemoval ?? true
    const ironing = options.ironing ?? true
    const textRestore = options.textRestore ?? true

    // 1. Find product — 404 if missing
    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // 2. Single-tenant dev: first business is current
    const business = await db.business.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    // 3. Resolve input payload
    const inputArray = inputType === 'video' ? videoFrames : images
    if (inputArray.length === 0) {
      return NextResponse.json(
        { error: `No ${inputType === 'video' ? 'videoFrames' : 'images'} provided` },
        { status: 400 }
      )
    }
    const firstInput = inputArray[0]

    // 4. Create ProductMediaAsset record with status=processing
    const asset = await db.productMediaAsset.create({
      data: {
        productId: id,
        businessId: business.id,
        inputType,
        inputUrl: firstInput,
        inputCount: inputArray.length,
        status: 'processing',
        progress: 0,
        bgRemoved: false,
        ironingApplied: false,
        textRestored: false,
      },
    })

    // 5. Simulated AI processing pipeline (§1, §2.1, §2.2, §3.1)
    // Stage 1 (0→20%): Analyzing raw media & spatial reference structure
    await sleep(800)
    await db.productMediaAsset.update({
      where: { id: asset.id },
      data: { progress: 20 },
    })

    // Stage 2 (20→40%): Background removal (§1.1)
    if (bgRemoval) {
      await sleep(700)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 40, bgRemoved: true },
      })
    } else {
      await sleep(200)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 40 },
      })
    }

    // Stage 3 (40→60%): AI digital ironing (§2.1)
    if (ironing) {
      await sleep(700)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 60, ironingApplied: true },
      })
    } else {
      await sleep(200)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 60 },
      })
    }

    // Stage 4 (60→80%): HD text & logo restoration (§2.2)
    if (textRestore) {
      await sleep(600)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 80, textRestored: true },
      })
    } else {
      await sleep(200)
      await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { progress: 80 },
      })
    }

    // Stage 5 (80→95%): 3D mesh geometry generation
    await sleep(800)
    await db.productMediaAsset.update({
      where: { id: asset.id },
      data: { progress: 95 },
    })

    // Stage 6 (95→100%): Anti-deformation guardrail — symmetry & volume validation (§3.1)
    await sleep(500)

    // 5. Compute quality scores (simulated, realistic ranges)
    const qualityScore = boundedRandom(88, 98)
    const symmetryScore = boundedRandom(90, 99)
    const volumeMatch = boundedRandom(91, 99)
    const matchScore = boundedRandom(88, 99)

    // 6. Anti-deformation guardrail — matchScore < 90 means reject
    if (matchScore < 90) {
      const rejectionReason =
        `Generated model does not match raw reference (match score: ${matchScore}% < 90%). Regenerating...`
      const rejected = await db.productMediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'rejected',
          progress: 100,
          qualityScore,
          symmetryScore,
          volumeMatch,
          matchScore,
          rejectionReason,
        },
      })
      return NextResponse.json({
        ok: false,
        rejected: true,
        reason: rejectionReason,
        asset: rejected,
      })
    }

    // 7. Success — generate mesh data and multi-angle exports (simulated)
    const meshData = JSON.stringify({
      vertices: 12450,
      faces: 24892,
      bounds: { x: 0.45, y: 0.62, z: 0.38 },
      confidenceScore: matchScore,
    })

    const completed = await db.productMediaAsset.update({
      where: { id: asset.id },
      data: {
        status: 'completed',
        progress: 100,
        qualityScore,
        symmetryScore,
        volumeMatch,
        matchScore,
        meshData,
        // In production these would be cleaned/rendered assets — for the demo
        // we point them all at the first input image to keep things lightweight.
        processedImageUrl: firstInput,
        frontViewUrl: firstInput,
        backViewUrl: firstInput,
        leftViewUrl: firstInput,
        rightViewUrl: firstInput,
        // spin video is generated on-demand by /multi-angle-export
        spinVideoUrl: null,
      },
    })

    // 8. Return full updated record
    return NextResponse.json({ ok: true, asset: completed })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
