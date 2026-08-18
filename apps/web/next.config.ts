import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma runs in driver-adapter mode (packages/db/prisma/schema.prisma:
  // `engineType = "client"`) — no native OS-specific query-engine binary
  // exists anywhere in this project. Declaring @prisma/client external
  // leaves its runtime file read (see packages/db/src/wasmCompilerPatch.ts)
  // to plain Node `require()` resolution instead of webpack bundling it.
  //
  // Deliberately NOT paired with an outputFileTracingIncludes entry for
  // the WASM query compiler, even though that file still technically
  // exists on disk after `prisma generate`. Three separate attempts to get
  // Vercel's output-file tracer to reliably ship a Prisma-generated
  // runtime file — this WASM compiler once, a native query-engine binary
  // twice before it — each looked correct against a local build's own
  // `.next/server/**/*.nft.json` trace and each still failed in production
  // with the file missing. packages/db/src/wasmCompilerPatch.ts now
  // patches the one fs.readFileSync call that would otherwise look for
  // that file, so nothing in the deployed function depends on Vercel
  // finding it — see docs/deployment.md for the full history and how
  // that's verified.
  serverExternalPackages: ["@prisma/client"],
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
