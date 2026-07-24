import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // §VERCEL-FIX: Removed output: "standalone" — Vercel has its own build system
  // and doesn't need standalone output. standalone is for Docker/self-hosting
  // and can cause issues on Vercel (missing files, incorrect server path).
  typescript: {
    ignoreBuildErrors: true,
  },
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
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

export default nextConfig;
