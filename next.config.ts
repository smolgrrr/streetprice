import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const snapshotFiles = [
  "./data/snapshot.json",
  "./data/annual-capacity.json",
  "./data/sizing-curves.json",
  "./data/constraint-model.json",
  "./data/constraint-search-result.json",
];

const nextConfig: NextConfig = {
  turbopack: {
    root,
  },
  // Include data read from disk by page revalidation and the snapshot API.
  outputFileTracingIncludes: {
    "/": snapshotFiles,
    "/api/snapshot": snapshotFiles,
  },
};

export default nextConfig;
