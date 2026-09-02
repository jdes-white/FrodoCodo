import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Batch screenshot import (apps/web/app/(app)/import) submits a whole
    // multi-file selection as one Server Action call — Next's default 1MB
    // body limit is far too small for even a handful of phone photos.
    // Screenshots are read from this request body directly into memory
    // and never written to disk (see apps/web/lib/screenshotImport.ts), so
    // raising this limit doesn't create a new storage surface, just a
    // larger single in-memory request.
    serverActions: { bodySizeLimit: "50mb" },
  },
  // Prisma's generated client resolves its native query-engine binary via
  // a runtime fs read computed from the OS/libc target — Prisma's own
  // recommendation for Next.js is to declare it external so webpack leaves
  // that resolution to plain Node `require()` instead of bundling it. This
  // is generic Next.js + Prisma guidance, unrelated to any specific
  // hosting platform.
  serverExternalPackages: ["@prisma/client"],
  transpilePackages: [
    "@frodocodo/shared",
    "@frodocodo/domain",
    "@frodocodo/ledger",
    "@frodocodo/providers",
    "@frodocodo/ai",
    "@frodocodo/db",
    // Task 7C: apps/web's live-connection flow reuses apps/worker's
    // syncConnection() (the real dedupe/classify/reconcile pipeline)
    // rather than re-implementing it — see syncConnection.ts's doc comment.
    "@frodocodo/worker",
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
