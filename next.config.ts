import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // /app carries the user's email: no shared cache (the PPR shell is CDN-cached otherwise) and no back-button copy.
  async headers() {
    return [{ source: "/app/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
