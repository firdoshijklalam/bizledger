# Agent Context — Task 2-b

**Task ID:** 2-b
**Agent:** ai-reconstruct-studio-agent
**Task:** Build the AI 3D Reconstruction Studio modal component (PRD Part 34 frontend) for BizLedger.

## File delivered
- `/home/z/my-project/src/components/shared/ai-reconstruct-studio.tsx` (~1370 LOC, self-contained `'use client'` component)

## What it does
A full-screen `Dialog` (`max-w-3xl max-h-[90vh]`) implementing a 3-phase AI 3D reconstruction studio:

1. **UPLOAD** — input-type toggle (📷 Photos / 🎬 Video), dashed upload zone with thumbnail grid, video frame extraction (5 frames via `<video>`+`<canvas>`), 3 AI option checkboxes (bg removal / ironing / text restore), emerald-gradient Start button, optional "View Previous Results" button.
2. **PROCESSING** — animated 6-stage vertical pipeline (Eye → Scissors → Wind → Type → Box → ShieldCheck) with Framer Motion `staggerChildren`, pulsing emerald ring on active stage, progress bar, "GLM 5.2 Vision Core is processing…" footer. Stage timer advances every 780ms; calls `POST /api/products/[id]/3d-reconstruct` synchronously and transitions on response.
3. **RESULTS** — rejection card (red, with reason + match score + Try Again) OR results dashboard: 4 SVG circular quality gauges (quality/symmetry/volumeMatch/matchScore, color-coded, check badge when ≥90), before/after image comparison, processing-applied pills, mesh info card (vertices/faces/bounds/confidence from `meshData` JSON), multi-angle export section (Generate button → 2×2 angle grid + 360° spin video player), and action buttons (Download All / Share to WhatsApp / Done).

## Backend endpoints used (all built by task 2-a)
- `POST /api/products/[id]/3d-reconstruct` — synchronous ~4.1s pipeline. Body: `{ inputType, images?|videoFrames?, options:{bgRemoval,ironing,textRestore} }`. Returns `{ ok, asset, rejected?, reason? }`.
- `GET /api/products/[id]/media-assets` — returns `{ assets: [...] }`. Used to detect previous completed assets for the "View Previous Results" button.
- `POST /api/products/[id]/multi-angle-export` — body `{ angles:['front','back','left','right'], generateSpinVideo:true }`. Returns `{ ok, asset:{spinVideoUrl}, exportedAngles, images:[{url,viewAngle,isHD}] }`.

## Asset field shape (from backend)
`{ id, status, progress, qualityScore, symmetryScore, volumeMatch, matchScore, processedImageUrl, frontViewUrl, backViewUrl, leftViewUrl, rightViewUrl, spinVideoUrl, rejectionReason, ironingApplied, textRestored, bgRemoved, meshData (JSON string), inputUrl, inputType }`

## Component API
```tsx
interface AIReconstructStudioProps {
  productId: string
  productName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}
```
Local state only (no Zustand). Resets to phase 1 when the modal closes (via `onOpenChange` wrapper, not an effect — avoids `react-hooks/set-state-in-effect`).

## Integration note for the next agent
Import and render from any product view/card:
```tsx
import { AIReconstructStudio } from '@/components/shared/ai-reconstruct-studio'
// <AIReconstructStudio productId={p.id} productName={p.name} open={open} onOpenChange={setOpen} />
```
No parent state plumbing needed beyond `open`/`onOpenChange`.

## Verification
- `bunx tsc --noEmit` → 0 errors in this file (annotated Framer Motion `Variants` type on `containerVariants`/`stageVariants` to satisfy strict ease-literal typing).
- `bun run lint` → 0 errors, 0 warnings (removed 4 unused `@next/next/no-img-element` disable directives since that rule is OFF in eslint.config.mjs; plain `<img>` is allowed).
- Dev server compiles cleanly (component is client-only; no route imports it yet, so no compile triggered until wired in).
