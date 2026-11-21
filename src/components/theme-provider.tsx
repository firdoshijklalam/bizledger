'use client'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { type ThemeProviderProps } from 'next-themes'
import { useEffect } from 'react'
import { usePaletteStore, applyPalette, setupPaletteThemeSync } from '@/store/palette-store'
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const activePalette = usePaletteStore((s) => s.activePalette)
  useEffect(() => { applyPalette(activePalette) }, [activePalette])
  useEffect(() => { setupPaletteThemeSync() }, [])
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
