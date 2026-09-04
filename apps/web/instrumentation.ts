/**
 * TEMPORARY — see `@/lib/categorizationSelfTest`'s doc comment. Next.js's
 * standard `register()` hook, called once per server process on boot
 * (stable in Next.js 15, no config flag needed). Used here purely so the
 * production categorisation self-test can run automatically on the next
 * deploy, without any browser/phone session — set
 * `RUN_CATEGORIZATION_SELF_TEST_ON_BOOT=1` before deploying, then unset it
 * (or leave at a value other than "1") once done so a later restart
 * doesn't repeat it. DELETE this file once the categorisation defect is
 * established.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_CATEGORIZATION_SELF_TEST_ON_BOOT !== "1") return;

  const { runCategorizationSelfTest, runOrchestrationSelfTest } = await import("./lib/categorizationSelfTest");
  try {
    const result = await runCategorizationSelfTest();
    console.log(JSON.stringify({ scope: "categorySuggestion", event: "self_test_on_boot", result }));
  } catch (err) {
    console.log(
      JSON.stringify({
        scope: "categorySuggestion",
        event: "self_test_on_boot_failed",
        reason: err instanceof Error ? err.message : "unknown error",
      }),
    );
  }

  try {
    const result = await runOrchestrationSelfTest();
    console.log(JSON.stringify({ scope: "categorySuggestion", event: "orchestration_self_test_on_boot", result }));
  } catch (err) {
    console.log(
      JSON.stringify({
        scope: "categorySuggestion",
        event: "orchestration_self_test_on_boot_failed",
        reason: err instanceof Error ? err.message : "unknown error",
      }),
    );
  }
}
