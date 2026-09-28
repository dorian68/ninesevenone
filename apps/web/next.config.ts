import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingExcludes: {
    "/api/prospect-factory/*": ["../../data/prospects-db/**/*", "./data/prospects-db/**/*"]
  }
};

export default nextConfig;
