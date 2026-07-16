/** @type {import('next').NextConfig} */
const nextConfig = {
  // R3F + Lenis set up their own render/scroll loops; StrictMode's double-mount
  // in dev duplicates tickers/ScrollTriggers, so we disable it for this app.
  reactStrictMode: false,
};

export default nextConfig;
