/**
 * Shared by screenshotSanitizer.ts and screenshotExtraction.ts. A real PNG
 * or JPEG can never start with this ASCII text (both formats have a fixed
 * binary magic-number prefix), so checking for it is a safe, unambiguous
 * way for either module's "real" implementation to recognize a Playwright
 * test fixture and replay canned output instead of attempting real image
 * decoding / calling a real AI provider — never reachable for a genuine
 * user-supplied screenshot.
 */
export const TEST_FIXTURE_MARKER = "FRODOCODO_SCREENSHOT_TEST_FIXTURE_V1:";
