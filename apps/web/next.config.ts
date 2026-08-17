import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's query engine binary is resolved dynamically at runtime
  // (fs.readFileSync of a path computed from the OS/libc target) rather than
  // via a static `require`/`import`, which Next's output file tracer
  // (@vercel/nft) can fail to detect inside pnpm's nested .pnpm store —
  // deployed functions build fine but crash at runtime with "Query Engine
  // could not be located". Declaring @prisma/client external leaves it to
  // plain Node `require()` resolution instead of bundling/tracing it, which
  // is Prisma's own documented fix for this exact Next.js/Vercel scenario.
  serverExternalPackages: ["@prisma/client"],
  // Belt-and-braces on top of serverExternalPackages: verified locally (by
  // inspecting the emitted .nft.json trace files) that Next's output file
  // tracer still fails to detect the query-engine binary even with the
  // package marked external — the generated `.prisma/client` directory
  // sits several levels deep inside pnpm's hashed `.pnpm` virtual store,
  // and nft's static analysis doesn't follow Prisma's runtime `fs`-based
  // binary resolution there. Force-including it for every route is what
  // actually gets the binary into the deployed function — this is Prisma's
  // own documented fallback for this exact failure mode. The `@prisma+client@*`
  // glob segment tolerates the version-hash changing between installs.
  outputFileTracingIncludes: {
    // "/**/*" alone doesn't match the bare root route ("/") under minimatch
    // (confirmed locally: the dashboard's page.js.nft.json had zero Prisma
    // files with only the wildcard present) — list "/" explicitly too.
    "/": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*"],
    "/**/*": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*"],
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
