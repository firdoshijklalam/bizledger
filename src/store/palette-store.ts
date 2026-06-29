import { create } from 'zustand'
import { persist } from 'zustand/middleware'
export type PaletteId = 'emerald' | 'ocean' | 'sunset' | 'royal'
export interface Palette { id: PaletteId; name: string; nameBn: string; emoji: string; light: any; dark: any }
export const PALETTES: Palette[] = [
  { id: 'emerald', name: 'Emerald', nameBn: 'পান্না', emoji: '🌿', light: { primary: 'oklch(0.52 0.13 152)', primaryForeground: 'oklch(0.99 0.01 150)', ring: 'oklch(0.52 0.13 152)', chart1: 'oklch(0.6 0.15 152)', chart2: 'oklch(0.65 0.16 70)', chart3: 'oklch(0.6 0.18 25)', chart4: 'oklch(0.55 0.13 230)', chart5: 'oklch(0.7 0.15 300)' }, dark: { primary: 'oklch(0.72 0.17 155)', primaryForeground: 'oklch(0.13 0.02 155)', ring: 'oklch(0.72 0.17 155)', chart1: 'oklch(0.72 0.17 155)', chart2: 'oklch(0.75 0.16 70)', chart3: 'oklch(0.7 0.2 25)', chart4: 'oklch(0.68 0.15 230)', chart5: 'oklch(0.78 0.16 300)' } },
  { id: 'ocean', name: 'Ocean Blue', nameBn: 'নীল সাগর', emoji: '🌊', light: { primary: 'oklch(0.5 0.16 240)', primaryForeground: 'oklch(0.99 0.01 240)', ring: 'oklch(0.5 0.16 240)', chart1: 'oklch(0.58 0.16 240)', chart2: 'oklch(0.6 0.15 190)', chart3: 'oklch(0.62 0.17 280)', chart4: 'oklch(0.55 0.14 150)', chart5: 'oklch(0.68 0.15 330)' }, dark: { primary: 'oklch(0.7 0.17 240)', primaryForeground: 'oklch(0.12 0.03 240)', ring: 'oklch(0.7 0.17 240)', chart1: 'oklch(0.7 0.17 240)', chart2: 'oklch(0.72 0.16 190)', chart3: 'oklch(0.72 0.18 280)', chart4: 'oklch(0.68 0.15 150)', chart5: 'oklch(0.78 0.16 330)' } },
  { id: 'sunset', name: 'Sunset Orange', nameBn: 'সূর্যাস্ত', emoji: '🌅', light: { primary: 'oklch(0.6 0.2 35)', primaryForeground: 'oklch(0.99 0.01 35)', ring: 'oklch(0.6 0.2 35)', chart1: 'oklch(0.65 0.2 35)', chart2: 'oklch(0.6 0.18 15)', chart3: 'oklch(0.62 0.16 330)', chart4: 'oklch(0.55 0.14 150)', chart5: 'oklch(0.68 0.15 70)' }, dark: { primary: 'oklch(0.72 0.19 40)', primaryForeground: 'oklch(0.14 0.03 40)', ring: 'oklch(0.72 0.19 40)', chart1: 'oklch(0.75 0.19 40)', chart2: 'oklch(0.72 0.18 15)', chart3: 'oklch(0.74 0.17 330)', chart4: 'oklch(0.68 0.15 150)', chart5: 'oklch(0.78 0.16 70)' } },
  { id: 'royal', name: 'Royal Purple', nameBn: 'রাজকীয় বেগুনি', emoji: '👑', light: { primary: 'oklch(0.5 0.2 295)', primaryForeground: 'oklch(0.99 0.01 295)', ring: 'oklch(0.5 0.2 295)', chart1: 'oklch(0.58 0.2 295)', chart2: 'oklch(0.6 0.17 330)', chart3: 'oklch(0.62 0.16 240)', chart4: 'oklch(0.55 0.15 190)', chart5: 'oklch(0.68 0.16 35)' }, dark: { primary: 'oklch(0.7 0.2 295)', primaryForeground: 'oklch(0.12 0.03 295)', ring: 'oklch(0.7 0.2 295)', chart1: 'oklch(0.72 0.2 295)', chart2: 'oklch(0.74 0.18 330)', chart3: 'oklch(0.72 0.17 240)', chart4: 'oklch(0.68 0.16 190)', chart5: 'oklch(0.78 0.16 35)' } },
]
interface PaletteState { activePalette: PaletteId; setPalette: (id: PaletteId) => void; getPalette: () => Palette }
export const usePaletteStore = create<PaletteState>()(persist((set, get) => ({
  activePalette: 'emerald',
  setPalette: (id) => { set({ activePalette: id }); applyPalette(id) },
  getPalette: () => PALETTES.find((p) => p.id === get().activePalette) || PALETTES[0],
}), { name: 'bizledger-palette', onRehydrateStorage: () => (state) => { if (state) applyPalette(state.activePalette) } }))
export function applyPalette(id: PaletteId) {
  if (typeof document === 'undefined') return
  const palette = PALETTES.find((p) => p.id === id) || PALETTES[0]
  const root = document.documentElement
  root.setAttribute('data-palette', id)
  const isDark = root.classList.contains('dark')
  const vals = isDark ? palette.dark : palette.light
  root.style.setProperty('--primary', vals.primary)
  root.style.setProperty('--primary-foreground', vals.primaryForeground)
  root.style.setProperty('--ring', vals.ring)
  root.style.setProperty('--chart-1', vals.chart1)
  root.style.setProperty('--chart-2', vals.chart2)
  root.style.setProperty('--chart-3', vals.chart3)
  root.style.setProperty('--chart-4', vals.chart4)
  root.style.setProperty('--chart-5', vals.chart5)
  root.style.setProperty('--sidebar-primary', vals.primary)
  root.style.setProperty('--sidebar-primary-foreground', vals.primaryForeground)
  root.style.setProperty('--sidebar-ring', vals.ring)
}
export function setupPaletteThemeSync() {
  if (typeof window === 'undefined') return
  const observer = new MutationObserver(() => {
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    const paletteId = (root.getAttribute('data-palette') || 'emerald') as PaletteId
    const palette = PALETTES.find((p) => p.id === paletteId) || PALETTES[0]
    const vals = isDark ? palette.dark : palette.light
    root.style.setProperty('--primary', vals.primary)
    root.style.setProperty('--primary-foreground', vals.primaryForeground)
    root.style.setProperty('--ring', vals.ring)
    root.style.setProperty('--chart-1', vals.chart1)
    root.style.setProperty('--chart-2', vals.chart2)
    root.style.setProperty('--chart-3', vals.chart3)
    root.style.setProperty('--chart-4', vals.chart4)
    root.style.setProperty('--chart-5', vals.chart5)
    root.style.setProperty('--sidebar-primary', vals.primary)
    root.style.setProperty('--sidebar-primary-foreground', vals.primaryForeground)
    root.style.setProperty('--sidebar-ring', vals.ring)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
