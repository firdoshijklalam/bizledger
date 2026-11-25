import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/lib/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BizLedger — Digital Khata for Modern Business",
  description: "Mobile-first business management platform for Indian traders. Khata, inventory, billing, GST & reports.",
  keywords: ["BizLedger", "Khata", "Billing", "GST", "Inventory", "Indian Business", "Ledger"],
  authors: [{ name: "BizLedger" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "BizLedger",
    statusBarStyle: "black-translucent",
  },
  // §PWA-ICONS: Required for installability + iOS Add to Home Screen
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#1a7a42",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // §KEYBOARD-VIEWPORT-FIX: W3C VirtualKeyboard API — tell the browser to
  // ONLY resize the VISUAL viewport (not the LAYOUT viewport) when the soft
  // keyboard opens. This is THE modern standard for making position:fixed
  // elements (FAB, mic, bottom nav) stay anchored to the visible screen
  // instead of scrolling with the document when the keyboard pushes content.
  // Supported in Chrome 108+ (Android). Older browsers ignore it gracefully.
  interactiveWidget: "resizes-visual",
  // §SAFE-AREA: respect notches / dynamic island / home indicator
  viewportFit: "cover",
} as Viewport;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground overscroll-none`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <QueryProvider>
            {children}
            <Toaster position="top-center" closeButton richColors />
          </QueryProvider>
        </ThemeProvider>
        {/* §PWA-SW: Register the production service worker for offline app shell.
            The SW uses network-first for HTML, cache-first for static assets,
            and NEVER caches API responses (financial data stays fresh).
            §DEV-GUARD: in development the SW is NOT registered — its static
            chunk cache (`bizledger-v1-static`) goes stale between hot reloads
            and serves pre-edit JS, which silently breaks browser QA (fixed
            code appears still-broken). In dev we go further and actively
            UNREGISTER any leftover SW + clear its caches to heal browsers
            that registered one from an earlier production build/session. */}
        <script
          dangerouslySetInnerHTML={{
            __html: process.env.NODE_ENV === 'production'
              ? `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').then(function(reg){console.log('SW registered',reg.scope)}).catch(function(e){console.warn('SW registration failed',e)})})}`
              : `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.getRegistrations().then(function(rs){if(rs.length){rs.forEach(function(r){r.unregister()});console.log('[dev] unregistered',rs.length,'stale service worker(s) — SW is disabled in development')}})});if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})})}}`,
          }}
        />
      </body>
    </html>
  );
}
