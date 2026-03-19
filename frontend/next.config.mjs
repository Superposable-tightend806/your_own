/** @type {import('next').NextConfig} */

const extraOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok.io",
    ...extraOrigins,
  ],
  async rewrites() {
    return [
      // Proxy all /api/* requests (including static files) to the backend.
      // This avoids CORS issues when the frontend is served via ngrok or
      // any remote domain where same-origin policy applies.
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable webpack's persistent cache in development to avoid packfile OOMs
      // on low-memory Windows setups.
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
