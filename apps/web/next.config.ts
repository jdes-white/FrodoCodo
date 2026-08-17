import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's query engine binary is resolved dynamically at runtime
  // (fs.readFileSync of a path computed from the OS/libc target) rather than
  // via a static `require`/`import`. Declaring @prisma/client external
  // leaves it to plain Node `require()` resolution instead of
  // bundling/tracing it, which is Prisma's own documented starting point
  // for this Next.js/Vercel scenario.
  serverExternalPackages: ["@prisma/client"],
  // Belt-and-braces on top of serverExternalPackages: force-include the
  // generated `.prisma/client` directory (where the engine binary lives)
  // for every route, so a tracing miss can't silently drop it from a
  // deployed function's bundle. This previously pointed at pnpm's nested
  // `.pnpm` virtual store (`.pnpm/@prisma+client@<hash>/node_modules/.prisma/client`)
  // and, even though a local `next build` + .nft.json inspection showed the
  // binary included, production still failed with "Query Engine could not
  // be located" on /login. Root-level `.npmrc` (node-linker=hoisted) now
  // makes pnpm install a flat node_modules instead of that nested store, so
  // `.prisma/client` lives at the plain, well-supported path below — the
  // same layout npm/yarn users get by default and the one every
  // Prisma+Vercel guide assumes. Kept as defense-in-depth even though the
  // flat layout shouldn't need it.
  outputFileTracingIncludes: {
    // "/**/*" alone doesn't match the bare root route ("/") under minimatch
    // (confirmed locally: the dashboard's page.js.nft.json had zero Prisma
    // files with only the wildcard present) — list "/" explicitly too.
    "/": ["../../node_modules/.prisma/client/**/*"],
    "/**/*": ["../../node_modules/.prisma/client/**/*"],
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
