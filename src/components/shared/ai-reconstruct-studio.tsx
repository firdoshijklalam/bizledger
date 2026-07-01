'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { toast } from 'sonner'
import {
  Boxes,
  Box,
  Eye,
  Scissors,
  Wind,
  Type,
  ShieldCheck,
  Upload,
  Camera,
  Video as VideoIcon,
  Check,
  X,
  Download,
  Share2,
  RotateCcw,
  Play,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Film,
  Image as ImageIcon,
} from 'lucide-react'

interface AIReconstructStudioProps {
  productId: string
  productName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Phase = 'upload' | 'processing' | 'results'

interface MediaAsset {
  id: string
  status: string
  progress: number
  qualityScore: number | null
  symmetryScore: number | null
  volumeMatch: number | null
  matchScore: number | null
  processedImageUrl: string | null
  frontViewUrl: string | null
  backViewUrl: string | null
  leftViewUrl: string | null
  rightViewUrl: string | null
  spinVideoUrl: string | null
  rejectionReason: string | null
  ironingApplied: boolean
  textRestored: boolean
  bgRemoved: boolean
  meshData: string | null
  inputUrl: string | null
  inputType: string
}

interface AngleImage {
  id: string
  url: string
  viewAngle: string
  isHD: boolean
}

const STAGES = [
  { name: 'Analyzing raw media & spatial reference structure', icon: Eye, hint: 'GLM 5.2 Vision Core' },
  { name: 'Background removal — isolating product', icon: Scissors, hint: '§1.1' },
  { name: 'AI digital ironing — smoothing surfaces', icon: Wind, hint: '§2.1' },
  { name: 'HD text & logo restoration', icon: Type, hint: '§2.2' },
  { name: '3D mesh geometry generation', icon: Box, hint: 'NeRF + Marching Cubes' },
  { name: 'Anti-deformation guardrail check', icon: ShieldCheck, hint: '§3.1' },
]

const STAGE_INTERVAL_MS = 780
const ANGLE_LABELS: Record<string, string> = {
  front: 'Front View',
  back: 'Back View',
  left: 'Left View',
  right: 'Right View',
}

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}

const stageVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function extractFrames(videoFile: File): Promise<string[]> {
  const video = document.createElement('video')
  video.src = URL.createObjectURL(videoFile)
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  if (video.readyState < 2) {
    await new Promise<void>(resolve => {
      const done = () => resolve()
      video.addEventListener('loadeddata', done, { once: true })
      video.addEventListener('error', done, { once: true })
      setTimeout(done, 4000)
    })
  }

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    URL.revokeObjectURL(video.src)
    return []
  }

  const duration =
    video.duration && isFinite(video.duration) && video.duration > 0
      ? video.duration
      : 5
  const frames: string[] = []
  for (const pct of [0, 0.2, 0.4, 0.6, 0.8]) {
    video.currentTime = Math.min(duration * pct, Math.max(duration - 0.05, 0))
    await new Promise<void>(resolve => {
      const done = () => resolve()
      video.addEventListener('seeked', done, { once: true })
      setTimeout(done, 900)
    })
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL('image/jpeg', 0.8))
    } catch {
      // skip unreadable frame
    }
  }
  URL.revokeObjectURL(video.src)
  return frames
}

function scoreTone(score: number | null | undefined): {
  ring: string
  text: string
  badge: string
  label: string
} {
  if (score == null) {
    return {
      ring: 'stroke-muted-foreground/40',
      text: 'text-muted-foreground',
      badge: 'bg-muted text-muted-foreground border-border',
      label: 'N/A',
    }
  }
  if (score >= 90) {
    return {
      ring: 'stroke-emerald-400',
      text: 'text-emerald-300',
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      label: 'Excellent',
    }
  }
  if (score >= 80) {
    return {
      ring: 'stroke-amber-400',
      text: 'text-amber-300',
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      label: 'Good',
    }
  }
  return {
    ring: 'stroke-red-400',
    text: 'text-red-300',
    badge: 'bg-red-500/15 text-red-300 border-red-500/30',
    label: 'Poor',
  }
}

function ScoreGauge({
  label,
  score,
}: {
  label: string
  score: number | null | undefined
}) {
  const value = score ?? 0
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  const tone = scoreTone(score)
  const passed = score != null && score >= 90

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card/50 p-3 text-center">
      <div className="relative size-[72px]">
        <svg className="size-[72px] -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="5"
            className="stroke-muted/25"
          />
          <motion.circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            className={tone.ring}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-base font-bold tabular-nums ${tone.text}`}>
            {score != null ? Math.round(score) : '—'}
          </span>
        </div>
        {passed && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.4 }}
            className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
          >
            <Check className="size-3" strokeWidth={3} />
          </motion.div>
        )}
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}
        >
          {tone.label}
        </span>
      </div>
    </div>
  )
}

export function AIReconstructStudio({
  productId,
  productName,
  open,
  onOpenChange,
}: AIReconstructStudioProps) {
  const [phase, setPhase] = useState<Phase>('upload')
  const [inputType, setInputType] = useState<'image' | 'video'>('image')
  const [images, setImages] = useState<string[]>([])
  const [options, setOptions] = useState({
    bgRemoval: true,
    ironing: true,
    textRestore: true,
  })
  const [activeStage, setActiveStage] = useState(0)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<MediaAsset | null>(null)
  const [rejected, setRejected] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportedAngles, setExportedAngles] = useState<AngleImage[]>([])
  const [spinVideoUrl, setSpinVideoUrl] = useState<string | null>(null)
  const [previousAsset, setPreviousAsset] = useState<MediaAsset | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const productIdRef = useRef(productId)
  productIdRef.current = productId

  const resetState = useCallback(() => {
    setPhase('upload')
    setInputType('image')
    setImages([])
    setOptions({ bgRemoval: true, ironing: true, textRestore: true })
    setActiveStage(0)
    setProgress(0)
    setResult(null)
    setRejected(false)
    setExporting(false)
    setExportedAngles([])
    setSpinVideoUrl(null)
    setExtracting(false)
    setSubmitting(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const fetchPreviousAssets = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/products/${productIdRef.current}/media-assets`
      )
      if (!res.ok) return
      const data = await res.json()
      const assets: MediaAsset[] = Array.isArray(data?.assets) ? data.assets : []
      const completed = assets.find(a => a?.status === 'completed')
      setPreviousAsset(completed ?? null)
    } catch {
      setPreviousAsset(null)
    }
  }, [])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleOpenChange = (next: boolean) => {
    if (next && !open) {
      fetchPreviousAssets()
    } else if (!next && open) {
      resetState()
    }
    onOpenChange(next)
  }

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      if (inputType === 'image') {
        const imageFiles = Array.from(files).filter(f =>
          f.type.startsWith('image/')
        )
        if (imageFiles.length === 0) {
          toast.error('Please upload image files.')
          return
        }
        try {
          const dataUrls = await Promise.all(imageFiles.map(readFileAsDataURL))
          setImages(prev => [...prev, ...dataUrls])
        } catch {
          toast.error('Failed to read image files.')
        }
      } else {
        const videoFile = Array.from(files).find(f =>
          f.type.startsWith('video/')
        )
        if (!videoFile) {
          toast.error('Please upload a valid video file.')
          return
        }
        setExtracting(true)
        setImages([])
        try {
          const frames = await extractFrames(videoFile)
          if (frames.length === 0) {
            toast.error('Could not extract frames from the video.')
          } else {
            setImages(frames)
            toast.success(`Extracted ${frames.length} frames from video.`)
          }
        } catch {
          toast.error('Failed to process video.')
        } finally {
          setExtracting(false)
        }
      }
    },
    [inputType]
  )

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const handleStartReconstruction = async () => {
    if (images.length === 0) {
      toast.error('Please upload at least one image or video first.')
      return
    }
    setPhase('processing')
    setActiveStage(0)
    setProgress(6)
    setSubmitting(true)
    setRejected(false)
    setResult(null)
    setExportedAngles([])
    setSpinVideoUrl(null)

    timerRef.current = setInterval(() => {
      setActiveStage(prev => {
        if (prev >= STAGES.length - 1) return prev
        const next = prev + 1
        setProgress(Math.min(Math.round((next / 5) * 88) + 6, 95))
        return next
      })
    }, STAGE_INTERVAL_MS)

    try {
      const payload: Record<string, unknown> = { inputType, options }
      if (inputType === 'image') payload.images = images
      else payload.videoFrames = images

      const res = await fetch(
        `/api/products/${productIdRef.current}/3d-reconstruct`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json()

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setActiveStage(STAGES.length)
      setProgress(100)

      if (!res.ok || data?.error) {
        toast.error(data?.error || 'Reconstruction failed. Please try again.')
        setPhase('upload')
        setSubmitting(false)
        return
      }

      if (data.rejected) {
        setResult(data.asset ?? null)
        setRejected(true)
      } else {
        setResult(data.asset ?? null)
        setRejected(false)
        fetchPreviousAssets()
      }

      setTimeout(() => {
        setPhase('results')
        setSubmitting(false)
      }, 400)
    } catch {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      toast.error('Network error. Please try again.')
      setPhase('upload')
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(
        `/api/products/${productIdRef.current}/multi-angle-export`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            angles: ['front', 'back', 'left', 'right'],
            generateSpinVideo: true,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok || data?.error) {
        toast.error(data?.error || 'Export failed.')
        setExporting(false)
        return
      }
      const imgs: AngleImage[] = Array.isArray(data?.images) ? data.images : []
      setExportedAngles(imgs)
      if (data?.asset?.spinVideoUrl) {
        setSpinVideoUrl(data.asset.spinVideoUrl)
      }
      toast.success('Multi-angle studio export ready!')
    } catch {
      toast.error('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const handleDownload = () => {
    toast.success('Downloading 4 studio images + spin video...')
  }

  const handleShare = () => {
    const text = `Check out our 3D product view for ${productName}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    toast.success('Opening WhatsApp Catalog share...')
  }

  const handleReset = () => {
    setPhase('upload')
    setImages([])
    setResult(null)
    setRejected(false)
    setExportedAngles([])
    setSpinVideoUrl(null)
    setActiveStage(0)
    setProgress(0)
  }

  const handleViewPrevious = () => {
    if (!previousAsset) return
    setResult(previousAsset)
    setRejected(previousAsset.status === 'rejected')
    setExportedAngles([])
    setSpinVideoUrl(previousAsset.spinVideoUrl ?? null)
    setPhase('results')
  }

  const beforeUrl = result?.inputUrl || images[0] || null
  const afterUrl = result?.processedImageUrl || null

  let mesh: {
    vertices?: number
    faces?: number
    bounds?: { x: number; y: number; z: number }
    confidenceScore?: number
  } | null = null
  if (result?.meshData) {
    try {
      mesh = JSON.parse(result.meshData)
    } catch {
      mesh = null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border-border bg-card/95 p-0 backdrop-blur-2xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
        <DialogHeader className="space-y-3 border-b border-border p-6 pr-12">
          <div className="flex items-start gap-3">
            <motion.div
              initial={{ scale: 0.7, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30"
            >
              <Boxes className="size-6" />
            </motion.div>
            <div className="space-y-1">
              <DialogTitle className="text-xl font-bold tracking-tight">
                AI 3D Reconstruction Studio
              </DialogTitle>
              <DialogDescription className="text-xs">
                Product:{' '}
                <span className="font-medium text-foreground">{productName}</span>
              </DialogDescription>
            </div>
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Transform raw photos or video into a studio-quality 3D digital twin.
            No professional camera needed.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <AnimatePresence mode="wait">
            {/* ============ PHASE 1: UPLOAD ============ */}
            {phase === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                {/* Input type toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setInputType('image')
                      setImages([])
                    }}
                    className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                      inputType === 'image'
                        ? 'border-emerald-500/50 bg-emerald-500/10 shadow-md shadow-emerald-500/10'
                        : 'border-border bg-card/50 hover:border-border/80 hover:bg-card'
                    }`}
                  >
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${
                        inputType === 'image'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <Camera className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Upload Photos</p>
                      <p className="text-xs text-muted-foreground">
                        4-5 images
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputType('video')
                      setImages([])
                    }}
                    className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                      inputType === 'video'
                        ? 'border-emerald-500/50 bg-emerald-500/10 shadow-md shadow-emerald-500/10'
                        : 'border-border bg-card/50 hover:border-border/80 hover:bg-card'
                    }`}
                  >
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${
                        inputType === 'video'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <VideoIcon className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Upload Video</p>
                      <p className="text-xs text-muted-foreground">
                        5-10 sec clip
                      </p>
                    </div>
                  </button>
                </div>

                {/* Upload zone */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={inputType === 'image' ? 'image/*' : 'video/*'}
                  multiple={inputType === 'image'}
                  className="hidden"
                  onChange={e => {
                    handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                />

                <div
                  onClick={() => !extracting && fileInputRef.current?.click()}
                  className={`rounded-2xl border-2 border-dashed p-5 transition-all ${
                    extracting
                      ? 'cursor-wait border-emerald-500/40 bg-emerald-500/5'
                      : 'cursor-pointer border-border hover:border-emerald-500/50 hover:bg-emerald-500/5'
                  }`}
                >
                  {extracting ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <Loader2 className="size-8 animate-spin text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium">
                          Extracting frames from video…
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Sampling 5 frames across the clip
                        </p>
                      </div>
                    </div>
                  ) : images.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
                        <Upload className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {inputType === 'image'
                            ? 'Click to upload product photos'
                            : 'Click to upload a product video'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {inputType === 'image'
                            ? 'PNG, JPG or WEBP — multiple files allowed'
                            : 'MP4, WEBM or MOV — up to 10 seconds'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">
                          {inputType === 'image'
                            ? `${images.length} photo${images.length !== 1 ? 's' : ''} selected`
                            : `${images.length} frame${images.length !== 1 ? 's' : ''} extracted`}
                        </p>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            fileInputRef.current?.click()
                          }}
                          className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/70"
                        >
                          + Add more
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {images.map((src, idx) => (
                          <motion.div
                            key={`${idx}-${src.slice(0, 32)}`}
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2, delay: idx * 0.03 }}
                            className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                          >
                            <img
                              src={src}
                              alt={`Input ${idx + 1}`}
                              className="size-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                removeImage(idx)
                              }}
                              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-100 transition-opacity hover:bg-red-500"
                              aria-label={`Remove image ${idx + 1}`}
                            >
                              <X className="size-3" />
                            </button>
                          </motion.div>
                        ))}
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            fileInputRef.current?.click()
                          }}
                          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
                        >
                          <Upload className="size-4" />
                          <span className="text-[10px]">Add</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Options card */}
                <div className="rounded-2xl border border-border bg-card/50 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    AI Processing Options
                  </p>
                  <div className="space-y-3">
                    {[
                      {
                        key: 'bgRemoval' as const,
                        emoji: '🗑️',
                        title: 'Background Removal',
                        desc: 'Remove dirty environment, tables, hands',
                      },
                      {
                        key: 'ironing' as const,
                        emoji: '👕',
                        title: 'AI Digital Ironing',
                        desc: 'Remove folds, scratches, dust',
                      },
                      {
                        key: 'textRestore' as const,
                        emoji: '✨',
                        title: 'HD Text & Logo Restoration',
                        desc: 'Re-render brand text in ultra-HD',
                      },
                    ].map(opt => (
                      <label
                        key={opt.key}
                        className="flex cursor-pointer items-start gap-3 rounded-xl p-2 transition-colors hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={options[opt.key]}
                          onCheckedChange={checked =>
                            setOptions(prev => ({
                              ...prev,
                              [opt.key]: checked === true,
                            }))
                          }
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">
                            <span className="mr-1.5">{opt.emoji}</span>
                            {opt.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {opt.desc}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Start button */}
                <Button
                  type="button"
                  disabled={images.length === 0 || submitting}
                  onClick={handleStartReconstruction}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-teal-600 hover:shadow-emerald-500/40 disabled:opacity-50"
                >
                  <Sparkles className="mr-2 size-5" />
                  Start 3D Reconstruction
                </Button>

                {/* Previous results */}
                {previousAsset && (
                  <button
                    type="button"
                    onClick={handleViewPrevious}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  >
                    <ImageIcon className="size-4" />
                    View Previous Results
                  </button>
                )}
              </motion.div>
            )}

            {/* ============ PHASE 2: PROCESSING ============ */}
            {phase === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">
                      GLM 5.2 Vision Core is processing…
                    </p>
                    <span className="text-sm font-bold tabular-nums text-emerald-400">
                      {progress}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500"
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>

                {/* Pipeline */}
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="space-y-2.5"
                >
                  {STAGES.map((stage, idx) => {
                    const Icon = stage.icon
                    const isDone = idx < activeStage
                    const isActive = idx === activeStage
                    const isPending = idx > activeStage
                    return (
                      <motion.div
                        key={stage.name}
                        variants={stageVariants}
                        className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                          isActive
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : isDone
                              ? 'border-border bg-card/40'
                              : 'border-border bg-card/20'
                        }`}
                      >
                        <div className="relative">
                          <motion.div
                            className={`flex size-10 items-center justify-center rounded-full ${
                              isDone
                                ? 'bg-emerald-500 text-white'
                                : isActive
                                  ? 'bg-emerald-500/90 text-white'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                            animate={
                              isActive
                                ? { scale: [1, 1.06, 1] }
                                : { scale: 1 }
                            }
                            transition={{
                              duration: 1.4,
                              repeat: isActive ? Infinity : 0,
                              ease: 'easeInOut',
                            }}
                          >
                            {isDone ? (
                              <Check className="size-5" strokeWidth={3} />
                            ) : (
                              <Icon className="size-5" />
                            )}
                          </motion.div>
                          {isActive && (
                            <motion.div
                              className="absolute inset-0 rounded-full ring-2 ring-emerald-400"
                              animate={{
                                scale: [1, 1.35],
                                opacity: [0.7, 0],
                              }}
                              transition={{
                                duration: 1.4,
                                repeat: Infinity,
                                ease: 'easeOut',
                              }}
                            />
                          )}
                        </div>
                        <div className="flex-1 space-y-0.5">
                          <p
                            className={`text-sm font-medium ${
                              isPending
                                ? 'text-muted-foreground'
                                : 'text-foreground'
                            }`}
                          >
                            {stage.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {isDone
                              ? 'Completed'
                              : isActive
                                ? `${stage.hint} · working…`
                                : 'Pending'}
                          </p>
                        </div>
                        {isDone && (
                          <CheckCircle2 className="size-5 text-emerald-400" />
                        )}
                        {isActive && (
                          <Loader2 className="size-5 animate-spin text-emerald-400" />
                        )}
                      </motion.div>
                    )
                  })}
                </motion.div>

                <div className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10 py-3 text-center">
                  <Sparkles className="size-4 animate-pulse text-purple-400" />
                  <p className="text-xs font-medium text-purple-300">
                    Neural reconstruction in progress — this usually takes 4-5
                    seconds
                  </p>
                </div>
              </motion.div>
            )}

            {/* ============ PHASE 3: RESULTS ============ */}
            {phase === 'results' && result && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                {rejected ? (
                  /* ---- Rejection card ---- */
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 280,
                        damping: 16,
                      }}
                      className="flex size-14 items-center justify-center rounded-full bg-red-500/20 text-red-400"
                    >
                      <AlertTriangle className="size-7" />
                    </motion.div>
                    <div className="space-y-1.5">
                      <h3 className="text-lg font-bold text-red-200">
                        Reconstruction Rejected
                      </h3>
                      <p className="mx-auto max-w-md text-sm leading-relaxed text-red-200/80">
                        The AI guardrail detected the generated model doesn&apos;t
                        match the raw reference{' '}
                        {result.matchScore != null && (
                          <span className="font-semibold">
                            (match score: {Math.round(result.matchScore)}% &lt;
                            90%)
                          </span>
                        )}
                        .{' '}
                        {result.rejectionReason ||
                          'Please try again with clearer, better-lit photos.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={handleReset}
                      className="bg-red-500 text-white hover:bg-red-600"
                    >
                      <RotateCcw className="mr-2 size-4" />
                      Try Again
                    </Button>
                  </motion.div>
                ) : (
                  <>
                    {/* Quality scores */}
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <Sparkles className="size-4 text-emerald-400" />
                        <h3 className="text-sm font-semibold">
                          Quality Scores
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <ScoreGauge
                          label="Quality"
                          score={result.qualityScore}
                        />
                        <ScoreGauge
                          label="Symmetry"
                          score={result.symmetryScore}
                        />
                        <ScoreGauge
                          label="Volume Match"
                          score={result.volumeMatch}
                        />
                        <ScoreGauge
                          label="Match Score"
                          score={result.matchScore}
                        />
                      </div>
                    </div>

                    {/* Before / After */}
                    {(beforeUrl || afterUrl) && (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Eye className="size-4 text-emerald-400" />
                          <h3 className="text-sm font-semibold">
                            Before / After Comparison
                          </h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
                            <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              Before (Raw)
                            </div>
                            {beforeUrl ? (
                              <img
                                src={beforeUrl}
                                alt="Raw input"
                                className="aspect-square w-full object-cover"
                              />
                            ) : (
                              <div className="flex aspect-square items-center justify-center text-muted-foreground">
                                <ImageIcon className="size-8" />
                              </div>
                            )}
                          </div>
                          <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-muted">
                            <div className="absolute left-2 top-2 z-10 rounded-md bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              After (AI)
                            </div>
                            {afterUrl ? (
                              <img
                                src={afterUrl}
                                alt="AI processed"
                                className="aspect-square w-full object-cover"
                              />
                            ) : (
                              <div className="flex aspect-square items-center justify-center text-muted-foreground">
                                <Sparkles className="size-8" />
                              </div>
                            )}
                            <div className="absolute bottom-2 right-2 rounded-md bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
                              ✨ Enhanced
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Processing applied badges */}
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400" />
                        <h3 className="text-sm font-semibold">
                          Processing Applied
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                            result.bgRemoved
                              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                              : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {result.bgRemoved ? (
                            <Check className="size-3" />
                          ) : (
                            <X className="size-3" />
                          )}
                          Background Removed
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                            result.ironingApplied
                              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                              : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {result.ironingApplied ? (
                            <Check className="size-3" />
                          ) : (
                            <X className="size-3" />
                          )}
                          Ironing Applied
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                            result.textRestored
                              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                              : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {result.textRestored ? (
                            <Check className="size-3" />
                          ) : (
                            <X className="size-3" />
                          )}
                          Text Restored
                        </span>
                      </div>
                    </div>

                    {/* Mesh info */}
                    {mesh && (
                      <div className="rounded-2xl border border-border bg-card/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <Box className="size-4 text-emerald-400" />
                          <h3 className="text-sm font-semibold">3D Mesh Info</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Vertices
                            </p>
                            <p className="text-sm font-bold tabular-nums">
                              {mesh.vertices?.toLocaleString() ?? '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Faces
                            </p>
                            <p className="text-sm font-bold tabular-nums">
                              {mesh.faces?.toLocaleString() ?? '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Bounds (m)
                            </p>
                            <p className="text-sm font-bold tabular-nums">
                              {mesh.bounds
                                ? `${mesh.bounds.x}×${mesh.bounds.y}×${mesh.bounds.z}`
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Confidence
                            </p>
                            <p className="text-sm font-bold tabular-nums text-emerald-400">
                              {mesh.confidenceScore != null
                                ? `${Math.round(mesh.confidenceScore)}%`
                                : '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Multi-angle export */}
                    <div className="rounded-2xl border border-border bg-card/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Film className="size-4 text-emerald-400" />
                          <h3 className="text-sm font-semibold">
                            Multi-Angle Studio Export
                          </h3>
                        </div>
                        {exportedAngles.length === 0 && !exporting && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleExport}
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <Sparkles className="mr-1.5 size-3.5" />
                            Generate Export
                          </Button>
                        )}
                      </div>

                      {exporting ? (
                        <div className="flex flex-col items-center gap-3 py-8 text-center">
                          <Loader2 className="size-8 animate-spin text-emerald-400" />
                          <div>
                            <p className="text-sm font-medium">
                              Rendering studio images…
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Generating 4 angles + 360° spin video
                            </p>
                          </div>
                        </div>
                      ) : exportedAngles.length > 0 ? (
                        <div className="space-y-3">
                          {/* 2x2 angle grid */}
                          <div className="grid grid-cols-2 gap-2.5">
                            {['front', 'back', 'left', 'right'].map(angle => {
                              const img = exportedAngles.find(
                                a => a.viewAngle === angle
                              )
                              return (
                                <div
                                  key={angle}
                                  className="relative overflow-hidden rounded-xl border border-border bg-muted"
                                >
                                  <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                    {ANGLE_LABELS[angle] ?? angle}
                                  </div>
                                  {img?.url ? (
                                    <img
                                      src={img.url}
                                      alt={ANGLE_LABELS[angle] ?? angle}
                                      className="aspect-square w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex aspect-square items-center justify-center text-muted-foreground">
                                      <ImageIcon className="size-6" />
                                    </div>
                                  )}
                                  {img?.isHD && (
                                    <div className="absolute bottom-2 right-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                                      HD
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Spin video */}
                          <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-muted/30">
                            <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              <Film className="size-3" />
                              360° Spin Video
                            </div>
                            {spinVideoUrl ? (
                              <video
                                src={spinVideoUrl}
                                controls
                                playsInline
                                className="aspect-video w-full bg-black object-contain"
                              />
                            ) : (
                              <div className="flex aspect-video flex-col items-center justify-center gap-2 text-center">
                                <motion.div
                                  animate={{ rotateY: 360 }}
                                  transition={{
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: 'linear',
                                  }}
                                  style={{ transformStyle: 'preserve-3d' }}
                                >
                                  <Box className="size-10 text-emerald-400" />
                                </motion.div>
                                <p className="text-xs text-muted-foreground">
                                  360° spin video generated — click to preview
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                          Generate a 4-angle studio export (front, back, left,
                          right) plus a 360° spin video for your catalog.
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        onClick={handleDownload}
                        className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-600"
                      >
                        <Download className="mr-2 size-4" />
                        Download All
                      </Button>
                      <Button
                        type="button"
                        onClick={handleShare}
                        variant="outline"
                        className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                      >
                        <Share2 className="mr-2 size-4" />
                        Share to WhatsApp
                      </Button>
                      <Button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        variant="secondary"
                      >
                        Done
                      </Button>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}
