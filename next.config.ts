import type { NextConfig } from "next";

const installSalt = process.env.QADBAK_INSTALL_SALT?.trim() ?? "";

/** Match panel upload caps (Core 100 GB / Premium unlimited). */
const UPLOAD_BODY_LIMIT = "100gb";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Middleware clones request bodies (default 10MB). Large zip uploads were
    // truncated → broken multipart → HTML 500 instead of JSON.
    middlewareClientMaxBodySize: UPLOAD_BODY_LIMIT,
    serverActions: {
      bodySizeLimit: UPLOAD_BODY_LIMIT,
    },
  },
  async rewrites() {
    if (!installSalt) return [];
    return [
      {
        source: `/api/x/${installSalt}/:path*`,
        destination: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
