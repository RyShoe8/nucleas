import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["billing-engine"],
  reactCompiler: true,
  turbopack: {},
  images: {
    remotePatterns: [],
    // Allow images from uploads directory
    unoptimized: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; img-src 'self' data: https: blob:; media-src 'self' data: https: blob:; script-src 'self' 'unsafe-inline' https://cdn.cookie-script.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.ahrefs.com https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-src 'self' https://www.google.com https://www.gstatic.com; frame-ancestors 'none'; base-uri 'self';",
          },
        ],
      },
      {
        source: '/animation-studio/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob: https://rigby2d.com; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://rigby2d.com https://huggingface.co https://*.huggingface.co https://*.hf.co; frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
