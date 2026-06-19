import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use webpack instead of Turbopack to avoid Rust-level panic
  // with Unicode characters in the project path (文件修改)
  webpack: (config) => config,
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
