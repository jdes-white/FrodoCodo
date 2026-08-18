/**
 * Makes Prisma's driver-adapter client (`engineType = "client"` in
 * packages/db/prisma/schema.prisma) stop depending on a real file existing
 * on disk at runtime for its WASM query compiler.
 *
 * Background: the generated client loads `query_compiler_bg.wasm` via a
 * plain `fs.readFileSync(path.join(config.dirname, "query_compiler_bg.wasm"))`
 * (see node_modules/.prisma/client/index.js). Getting that one file
 * correctly included in a deployed Vercel serverless function was tried
 * three separate ways — declaring it in `binaryTargets` (when it was still
 * a native OS binary, before driver-adapter mode), an explicit
 * `outputFileTracingIncludes` glob pointing at pnpm's nested `.pnpm` store,
 * and the same glob after flattening `node_modules` with `node-linker=hoisted`
 * — and each one produced a local build whose own per-route nft.json trace
 * (under .next/server/app) said the file was included, and each one still
 * failed in production
 * with the file missing (ENOENT) from the actual deployed bundle. See
 * docs/deployment.md for the full history.
 *
 * Rather than attempt a fourth variation on "get Vercel's tracer to include
 * this file," this removes the file-system dependency entirely: the WASM
 * bytes are embedded as a base64 string in a generated TS module (see
 * packages/db/scripts/generate.mjs, which regenerates it on every
 * `prisma generate`) and compiled directly into the JS bundle like any
 * other constant — nothing for a file tracer to miss. This patches the one
 * `fs.readFileSync` call that would otherwise look for the real file, so it
 * returns the embedded bytes instead, regardless of whether the file
 * actually exists on disk in the deployed environment.
 *
 * Must be imported (for its side effect) before "@prisma/client" — see
 * packages/db/src/index.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { QUERY_COMPILER_WASM_BASE64 } from "./generated/queryCompilerWasm.js";

const WASM_FILENAME = "query_compiler_bg.wasm";
const PATCH_MARKER = Symbol.for("frodocodo.wasmCompilerPatch");

// Idempotent: dev hot-reload re-evaluates this module on every edit, and
// double-patching would otherwise wrap the wrapper repeatedly.
if (!(globalThis as Record<symbol, unknown>)[PATCH_MARKER]) {
  const wasmBytes = Buffer.from(QUERY_COMPILER_WASM_BASE64, "base64");
  const originalReadFileSync = fs.readFileSync;

  // fs.readFileSync is heavily overloaded; this patch only needs to
  // intercept the one call shape Prisma's generated code actually uses (a
  // single string path, no options) and delegate everything else, so
  // matching the full overload set isn't worth it — hence the `any` below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs.readFileSync = function patchedReadFileSync(filePath: unknown, ...rest: unknown[]): any {
    if (typeof filePath === "string" && path.basename(filePath) === WASM_FILENAME) {
      return wasmBytes;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalReadFileSync as any)(filePath, ...rest);
  };

  (globalThis as Record<symbol, unknown>)[PATCH_MARKER] = true;
}
