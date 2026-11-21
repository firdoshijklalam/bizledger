// PRD Part 34 §3.2 — Multi-angle studio export + 360° spin video.
// POST: render multi-angle images (front/back/left/right) from the completed
// 3D mesh, persist each as a ProductImage (imageType=multi_angle), and
// optionally attach a spin video URL to the media asset.
// GET:  return existing multi-angle ProductImages for the product.
//
// §AUTH: Both handlers require an authenticated business and verify the product
// belongs to that business before serving or generating media.

import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const VALID_ANGLES = ['front', 'back', 'left', 'right'] as const
type Angle = (typeof VALID_ANGLES)[number]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params

    // §OWNERSHIP: findFirst scoped to businessId — never findUnique by id alone.
    const product = await db.product.findFirst({ where: { id, businessId: business.id } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const images = await db.productImage.findMany({
      where: { productId: id, imageType: 'multi_angle' },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ images })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params

    // §OWNERSHIP: findFirst scoped to businessId — never findUnique by id alone.
    const product = await db.product.findFirst({ where: { id, businessId: business.id } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const body = await req.json()

    // Resolve angle list (default all 4)
    let angles: Angle[] = [...VALID_ANGLES]
    if (Array.isArray(body.angles) && body.angles.length > 0) {
      angles = body.angles.filter((a: string): a is Angle =>
        (VALID_ANGLES as readonly string[]).includes(a)
      )
      if (angles.length === 0) angles = [...VALID_ANGLES]
    }

    const generateSpinVideo = body.generateSpinVideo ?? true

    // 1. Find latest COMPLETED media asset for the product
    const asset = await db.productMediaAsset.findFirst({
      where: { productId: id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
    })
    if (!asset) {
      return NextResponse.json(
        { error: 'No completed 3D model found. Run 3D reconstruction first.' },
        { status: 400 }
      )
    }

    // 2. Simulate studio render pipeline
    await sleep(1500)

    const imageUrl = asset.processedImageUrl ?? asset.inputUrl ?? ''
    const createdImages: any[] = []

    // 3. Persist a ProductImage for each requested angle
    for (const angle of angles) {
      const img = await db.productImage.create({
        data: {
          productId: id,
          url: imageUrl,
          imageType: 'multi_angle',
          viewAngle: angle,
          isProcessed: true,
          isHD: true,
          isPrimary: false,
          order: 0,
        },
      })
      createdImages.push(img)
    }

    // 4. Optionally attach spin video URL (simulated MP4 → reuse processedImageUrl)
    let updatedAsset = asset
    if (generateSpinVideo) {
      updatedAsset = await db.productMediaAsset.update({
        where: { id: asset.id },
        data: { spinVideoUrl: imageUrl },
      })
    }

    // 5. Return asset + exported angle list
    return NextResponse.json({
      ok: true,
      asset: updatedAsset,
      exportedAngles: angles,
      images: createdImages,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
