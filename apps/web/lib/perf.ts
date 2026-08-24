import "server-only";

/**
 * Minimal server-side timing for a primary route's data-fetch — lets
 * route-transition latency be measured/compared before and after a change
 * (or against Render's real network conditions) without a profiler.
 * Logged as structured JSON, greppable from Render's logs by
 * `"scope":"perf"`, matching the style of the existing `"scope":"db"`
 * logs from @frodocodo/db.
 */
export async function withRouteTiming<T>(route: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    console.log(JSON.stringify({ scope: "perf", event: "route_data_fetch", route, durationMs }));
  }
}
