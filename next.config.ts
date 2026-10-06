import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only. Next blocks /_next client bundles unless the page host is
  // localhost or listed here, which leaves the SSR shell stuck offline.
  allowedDevOrigins: ["192.168.0.100", "127.0.0.1"],
};

export default nextConfig;
