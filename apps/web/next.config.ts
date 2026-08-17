import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma runs in driver-adapter mode (packages/db/prisma/schema.prisma:
  // `engineType = "client"`) — no native OS-specific query-engine binary
  // exists anywhere in this project anymore. The one remaining binary asset
  // is a small (~2MB), platform-agnostic WASM query compiler
  // (node_modules/.prisma/client/query_compiler_bg.wasm), loaded via a
  // plain `fs.readFileSync` at runtime rather than a static import (an
  // edge/worker-runtime build of the client uses a real `import()` instead,
  // which sounded more bundler-friendly, but its expected module shape
  // doesn't match what webpack's WASM handling produces for a bundled
  // Node.js server route — every query failed at runtime even though the
  // build succeeded, so that path was abandoned; see docs/deployment.md).
  // Declaring @prisma/client external avoids webpack touching that runtime
  // file read at all, and the include below guarantees the one file it
  // needs actually ships with the deployed function regardless of whether
  // Next's automatic tracing would have caught it on its own.
  serverExternalPackages: ["@prisma/client"],
  outputFileTracingIncludes: {
    "/": ["../../node_modules/.prisma/client/query_compiler_bg.*"],
    "/**/*": ["../../node_modules/.prisma/client/query_compiler_bg.*"],
  },
  transpilePackages: [
    "@frodocodo/shared",
    "@frodocodo/domain",
    "@frodocodo/ledger",
    "@frodocodo/providers",
    "@frodocodo/ai",
    "@frodocodo/db",
  ],
  webpack: (config) => {
    // The workspace packages are plain-ESM TS and import their own sibling
    // modules with an explicit ".js" extension (correct per Node's ESM
    // resolution and what tsx/vitest expect) — webpack's default resolver
    // doesn't know that maps to a ".ts" file on disk, so teach it to.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
