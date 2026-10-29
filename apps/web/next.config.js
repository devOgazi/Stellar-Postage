/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        source: '/@:handle',
        destination: '/:handle',
      },
    ];
  },
};

module.exports = nextConfig;
