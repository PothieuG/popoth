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

module.exports = nextConfig
