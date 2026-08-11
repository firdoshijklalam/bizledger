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
          // §CORS-FIX: Removed wildcard '*' — replaced with specific allowed origins.
          // In a same-origin Next.js app, CORS headers aren't needed for API calls.
          // External integrations (if any) should be explicitly allowlisted.
          // { key: 'Access-Control-Allow-Origin', value: '*' }, — REMOVED
        ],
      },
    ];
  },
};

export default nextConfig;
