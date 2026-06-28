/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.shopify.com' },
      { protocol: 'https', hostname: '**.myshopify.com' },
      { protocol: 'https', hostname: '**.woocommerce.com' },
      { protocol: 'https', hostname: '**.wp.com' },
    ],
  },
};

export default nextConfig;
