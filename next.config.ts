import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ticket-monitor",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
