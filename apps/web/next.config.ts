import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
