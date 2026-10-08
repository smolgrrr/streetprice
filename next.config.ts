import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root,
  },
  // loadSnapshot reads this path at runtime. The dynamic path is not traced on its own.
  outputFileTracingIncludes: {
    "/api/snapshot": ["./data/snapshot.json", "./data/constraint-model.json", "./data/constraint-search-result.json"],
  },
};

export default nextConfig;
