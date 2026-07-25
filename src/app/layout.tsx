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
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister();console.log('SW unregistered',r.scope)})}).catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
