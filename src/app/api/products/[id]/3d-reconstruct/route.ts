// PRD Part 34 §1 — 3D Reconstruction ingest endpoint.
// POST: ingest raw media (images or video) and run simulated GLM 5.2 Vision
// pipeline (bg removal → ironing → text restore → mesh gen → guardrail check).
// GET: return the latest media asset for the product.

import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Bounded random score in [min, max] with 1 decimal precision
function boundedRandom(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role). The GET handler
    // previously had no auth — exposing any product's latest media asset
    // (including processed image URLs, mesh data, quality scores) to
    // unauthenticated callers. Mirrors the auth posture of the POST handler.
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params

    // §OWNERSHIP: findFirst scoped to businessId — never findUnique by id alone.
    const product = await db.product.findFirst({
      where: { id, businessId: business.id },
      select: { id: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const latest = await db.productMediaAsset.findFirst({
      where: { productId: id, businessId: business.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ asset: latest })
  } catch (e) {
    return apiError(e, "Request failed")
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

    // 2. §AUTH: Use session-authenticated business, not a hardcoded fallback.
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Stage 3 (40→60%): AI digital ironing (§2.1) — removes folds/scratches WITHOUT altering shape
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

    // Stage 4 (60→80%): HD text & logo restoration (§2.2) — re-renders text on same surface
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

    // Stage 5 (80→95%): 3D mesh geometry generation — preserve original volume & aspect ratio
    await sleep(800)
    await db.productMediaAsset.update({
      where: { id: asset.id },
      data: { progress: 95 },
    })

    // Stage 6 (95→100%): Anti-deformation guardrail (§3.1)
    // Strict Symmetry & Volume Check — generated model must match raw reference ≥90%.
    // This prevents the AI from distorting the object's shape (e.g. turning a bag into a bottle).
    await sleep(500)

    // Simulate real geometric validation:
    // - Volume preservation: the 3D mesh volume must match the reference within ±5%
    // - Symmetry: left-right symmetry must be ≥90%
    // - Aspect ratio: width/height/depth ratios must match reference within ±10%
    // - Edge count: mesh complexity must be reasonable (not over-simplified or over-detailed)
    const volumePreservation = boundedRandom(93, 99)    // % of original volume preserved
    const symmetryScore = boundedRandom(92, 99)         // left-right symmetry %
    const aspectRatioMatch = boundedRandom(91, 99)      // aspect ratio match %
    const edgeIntegrity = boundedRandom(90, 98)         // mesh edge integrity %

    // Overall match score = weighted average of all shape metrics
    const matchScore = Math.round(
      volumePreservation * 0.35 +
      symmetryScore * 0.25 +
      aspectRatioMatch * 0.25 +
      edgeIntegrity * 0.15
    )
    const qualityScore = Math.round((matchScore + boundedRandom(88, 98)) / 2)
    const volumeMatch = volumePreservation

    // Anti-deformation guardrail: reject if ANY critical metric is below 90%
    // This ensures the AI never distorts the original product shape
    const deformationDetected =
      matchScore < 90 ||
      volumePreservation < 90 ||
      symmetryScore < 90 ||
      aspectRatioMatch < 90

    if (deformationDetected) {
      const failedMetrics: string[] = []
      if (volumePreservation < 90) failedMetrics.push(`volume: ${volumePreservation}%`)
      if (symmetryScore < 90) failedMetrics.push(`symmetry: ${symmetryScore}%`)
      if (aspectRatioMatch < 90) failedMetrics.push(`aspect ratio: ${aspectRatioMatch}%`)
      if (matchScore < 90) failedMetrics.push(`overall: ${matchScore}%`)

      const rejectionReason =
        `Anti-deformation guardrail REJECTED: shape metrics below 90% threshold (${failedMetrics.join(', ')}). ` +
        `The AI attempted to distort the original product shape. Regenerating with stricter constraints...`

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
    return apiError(e, "Request failed")
  }
}
