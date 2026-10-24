import type { NextConfig } from "next";

/**
 * Origin of the FastAPI backend. Every browser request to /api/* is proxied
 * there by the Next.js server, so the session cookie stays same-origin and no
 * CORS is involved. Rewrites are read when the server starts (dev) or when
 * `next build` runs (production), so set API_URL for that process.
 */
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/health", destination: `${API_URL}/health` },
    ];
  },
};

export default nextConfig;
