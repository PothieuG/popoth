const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {},
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-slot'],
  },
}

module.exports = withPWA(nextConfig)