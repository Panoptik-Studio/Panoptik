import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Workspace packages ship raw TS — let Next transpile them.
  transpilePackages: ["@panoptik/schema", "@panoptik/utils", "@panoptik/engine"],
};

export default nextConfig;
