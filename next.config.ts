import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // §SECURITY-FIX: Removed ignoreBuildErrors — TypeScript errors should NOT
  // be silently bypassed in production builds. They can hide real bugs.
  // typescript: { ignoreBuildErrors: true } — REMOVED
  reactStrictMode: false,
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-chat-*.space-z.ai",
    "localhost",
    "127.0.0.1",
    "21.0.14.243",
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          // §SECURITY-HEADERS: Standard security headers for production
          // Prevents MIME-type sniffing — browser trusts declared Content-Type
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Prevents clickjacking — page cannot be embedded in iframes
          { key: 'X-Frame-Options', value: 'DENY' },
          // Controls how much referrer info is sent with requests
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Restricts browser features (camera, mic, geolocation, etc.)
          // §MIC-FIX: microphone=(self) allows same-origin SpeechRecognition access.
          // camera=() still blocks camera (not needed for this app).
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          // §CORS-FIX: Removed wildcard '*' — same-origin app doesn't need CORS.
        ],
      },
    ];
  },
};

export default nextConfig;
