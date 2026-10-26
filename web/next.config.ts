import type { NextConfig } from "next";

/**
 * Origin of the FastAPI backend for server-side requests (middleware.ts, and
 * the /api rewrite below). The browser always calls a relative /api, so no API
 * URL is baked into the client bundle and a build does not depend on the
 * server's address.
 *
 * - Development: the Next.js dev server proxies /api/* to API_INTERNAL_URL
 *   (`make web-dev` sets it from APP_PORT).
 * - Production: Caddy sends /api/* straight to the API (deploy/Caddyfile.template),
 *   so the rewrite is only a fallback; API_INTERNAL_URL=http://127.0.0.1:8000.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Self-contained server (deploy/server-install.sh copies .next/standalone into a release).
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*` },
      { source: "/health", destination: `${API_INTERNAL_URL}/health` },
    ];
  },
};

export default nextConfig;
