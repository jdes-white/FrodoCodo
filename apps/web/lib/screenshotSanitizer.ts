import sharp from "sharp";
import { SCREENSHOT_SOURCES, type ScreenshotSource } from "@frodocodo/ai";

/**
 * Screenshot sanitisation — runs on every upload, before a single byte ever
 * reaches Anthropic (screenshot-import hardening task).
 *
 * Lives in `apps/web/lib`, not `packages/ai` (where the type it uses,
 * `ScreenshotSource`, is actually defined) — this is a deliberate exception
 * to keeping vision-adjacent code together. `packages/ai` is transpiled by
 * Next.js (`apps/web/next.config.ts`'s `transpilePackages`, needed so its
 * `./x.js`-suffixed relative imports resolve under webpack), which means
 * pnpm's own per-package `node_modules/sharp` symlink for that package
 * sits *inside* the package's own directory tree — Next's
 * bundling-opt-out heuristic (which packages besides Next's own get
 * externalized vs. bundled) matches by that symlink path, not sharp's real
 * resolved location, so it incorrectly classifies sharp as "part of the
 * transpiled package" and bundles it — breaking sharp's native-addon
 * loading ("Could not load the 'sharp' module using the linux-x64
 * runtime") even with `sharp` correctly declared in
 * `serverExternalPackages`. A plain `apps/web` source file has no such
 * problem (the app itself isn't a transpiled workspace dependency), so
 * this is the one piece of screenshot-import logic that lives here instead
 * of in `packages/ai` alongside vision extraction.
 *
 * The household never crops, redacts, or labels a screenshot themselves.
 * Instead this module deterministically (no AI call, no network) identifies
 * which of the three currently-supported banking-app layouts a screenshot
 * is, then crops away the fixed header/balance/nav regions that layout is
 * known to have — the areas where account names, balances, and navigation
 * chrome live — before the remaining transaction-list image is sent
 * anywhere. If the layout can't be confidently identified, the screenshot
 * is never forwarded in any form: it fails closed as UNSUPPORTED_LAYOUT
 * rather than silently falling back to sending the full raw image.
 *
 * Identification is a pixel-color heuristic, not a second AI call — asking
 * a vision model "which app is this and where is the header" would mean
 * showing it the very account/balance information this step exists to keep
 * away from Anthropic in the first place. Each of the three known apps has
 * a distinctive, consistent header colour (CBA: near-black dark-mode
 * chrome; Virgin Money: a strong brand red; Amex: a dark navy) sampled from
 * a thin strip at the very top of the image. This is necessarily a coarse
 * heuristic tuned from the *descriptions* of these apps' UIs, not
 * calibrated against real photographed screenshots — see the module-level
 * caveat in the hardening task's final report.
 *
 * Crop fractions are deliberately conservative: "accuracy takes priority
 * over aggressive cropping" per the task spec. Each layout's header/footer
 * fractions are sized to comfortably clear the balance card / tab bar with
 * margin to spare, at the cost of occasionally leaving a sliver of
 * non-transaction chrome in the sanitized image — never the reverse.
 *
 * Re-encoding the crop through sharp's PNG output also strips all embedded
 * metadata (EXIF orientation/device tags etc. a JPEG screenshot might
 * carry) as a side effect — one extra privacy margin beyond the pixel crop
 * itself.
 *
 * What is deliberately NOT attempted: OCR-based masking of stray
 * account/card digits *within* the transaction-row region. For all three
 * currently-known layouts, any such identifiers (Amex's masked card
 * digits, CBA/Virgin's account nicknames) only ever appear inside the
 * header/balance chrome this module already removes wholesale — there is
 * no known residual case within the cropped transaction-list region itself
 * to mask. If a future layout puts identifying information inside the
 * transaction rows, it does not qualify as a "currently known,
 * safely-sanitizable" layout and must fail closed here rather than being
 * silently under-protected.
 */

export interface SanitizedScreenshotImage {
  base64: string;
  mediaType: string;
}

export type ScreenshotSanitizationResult =
  | { status: "SANITIZED"; layout: ScreenshotSource; image: SanitizedScreenshotImage }
  | { status: "UNSUPPORTED_LAYOUT"; reason: string };

/**
 * Bytes a real PNG/JPEG can never start with (both formats have a fixed
 * binary magic-number prefix) — the same test-fixture-replay trick
 * `packages/ai/src/screenshotExtraction.ts`'s stub extractor uses, applied
 * here so Playwright can exercise the whole sanitize -> extract pipeline
 * without ever constructing or decoding a real image. Duplicated (not
 * imported from `packages/ai`) deliberately: this module must not import
 * anything from that package's src at runtime, since doing so would pull
 * the marker's home file back into consideration for the exact bundling
 * problem this module exists to route around. The literal value must stay
 * identical to `packages/ai/src/testFixtureMarker.ts`'s.
 */
const TEST_FIXTURE_MARKER = "FRODOCODO_SCREENSHOT_TEST_FIXTURE_V1:";

/** Header strip sampled for colour classification, as a fraction of image height. */
const HEADER_SAMPLE_FRACTION = 0.06;

/**
 * Crop fractions per known layout. Conservative on purpose — see the
 * module doc comment. Tuned from the *described* proportions of each app's
 * header/balance card and bottom tab bar, not calibrated against real
 * captured screenshots.
 */
const CROP_FRACTIONS: Record<ScreenshotSource, { top: number; bottom: number }> = {
  CBA: { top: 0.14, bottom: 0.06 },
  VIRGIN_MONEY: { top: 0.16, bottom: 0.07 },
  AMEX: { top: 0.18, bottom: 0.07 },
};

const MIN_WIDTH_PX = 100;
const MIN_HEIGHT_PX = 200;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

async function averageColor(buffer: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<RgbColor> {
  const { data } = await sharp(buffer).extract(region).resize(1, 1, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

/**
 * Classifies a screenshot's layout from its header-strip colour alone.
 * Exported for direct unit testing; also used internally by
 * `sanitizeScreenshot`. Returns `null` (never a guess) when the sample
 * doesn't confidently match one of the three known layouts.
 */
export async function detectScreenshotLayout(buffer: Buffer, width: number, height: number): Promise<ScreenshotSource | null> {
  const headerHeight = Math.max(1, Math.round(height * HEADER_SAMPLE_FRACTION));
  const { r, g, b } = await averageColor(buffer, { left: 0, top: 0, width, height: headerHeight });

  const brightness = (r + g + b) / 3;
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const isNeutral = maxChannel - minChannel < 25;
  const isDark = brightness < 80;
  const isRedDominant = r - Math.max(g, b) > 50;
  const isBlueDominant = b - Math.max(r, g) > 15 && b > 30 && brightness < 110;

  if (isRedDominant) return "VIRGIN_MONEY";
  if (isDark && isBlueDominant) return "AMEX";
  if (isDark && isNeutral) return "CBA";
  return null;
}

/**
 * Sanitizes one uploaded screenshot: identifies its layout, crops away the
 * header/balance/nav chrome for that layout, and returns the result as an
 * in-memory base64 image — never written to disk. Fails closed
 * (`UNSUPPORTED_LAYOUT`) rather than ever returning the original, uncropped
 * bytes when the layout can't be confidently identified or safely cropped.
 *
 * The one exception is the `TEST_FIXTURE_MARKER` replay path used by
 * Playwright (see `packages/ai/src/screenshotExtraction.ts`'s identical
 * mechanism) — a fixture's declared `source` stands in for real pixel
 * classification so tests never need to construct or decode real
 * PNG/JPEG bytes. A real screenshot's bytes can never begin with this
 * ASCII marker.
 */
export async function sanitizeScreenshot(buffer: Buffer, mediaType: string): Promise<ScreenshotSanitizationResult> {
  if (buffer.subarray(0, TEST_FIXTURE_MARKER.length).toString("utf8") === TEST_FIXTURE_MARKER) {
    return replayFixtureSanitization(buffer, mediaType);
  }

  let width: number;
  let height: number;
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    width = metadata.width;
    height = metadata.height;
  } catch {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Could not decode this file as an image." };
  }

  if (width < MIN_WIDTH_PX || height < MIN_HEIGHT_PX) {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Image is too small to safely identify and crop." };
  }

  let layout: ScreenshotSource | null;
  try {
    layout = await detectScreenshotLayout(buffer, width, height);
  } catch {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Could not analyze this screenshot's layout." };
  }
  if (!layout) {
    return {
      status: "UNSUPPORTED_LAYOUT",
      reason: "This screenshot didn't match a currently supported layout (CBA, Virgin Money, or Amex).",
    };
  }

  const { top, bottom } = CROP_FRACTIONS[layout];
  const topPx = Math.round(height * top);
  const bottomPx = Math.round(height * bottom);
  const cropHeight = height - topPx - bottomPx;
  // Sanity bound — the fixed fractions above never get close to this, but
  // never ship a crop that could plausibly have removed most of the list.
  if (cropHeight < height * 0.5) {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Computed crop region was not safe for this image." };
  }

  try {
    const cropped = await sharp(buffer)
      .extract({ left: 0, top: topPx, width, height: cropHeight })
      .png() // re-encoding also strips EXIF/other embedded metadata
      .toBuffer();
    return { status: "SANITIZED", layout, image: { base64: cropped.toString("base64"), mediaType: "image/png" } };
  } catch {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Could not crop this image safely." };
  }
}

function replayFixtureSanitization(buffer: Buffer, mediaType: string): ScreenshotSanitizationResult {
  const decoded = buffer.toString("utf8").slice(TEST_FIXTURE_MARKER.length);
  let source: unknown;
  try {
    source = JSON.parse(decoded).source;
  } catch {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Test fixture payload was not valid JSON." };
  }
  if (typeof source !== "string" || !(SCREENSHOT_SOURCES as readonly string[]).includes(source)) {
    return { status: "UNSUPPORTED_LAYOUT", reason: "Test fixture declared an unrecognized/unsupported source." };
  }
  // Passed through unchanged — the stub extractor re-parses this same JSON
  // payload as its "model response", so there is nothing to crop here.
  return { status: "SANITIZED", layout: source as ScreenshotSource, image: { base64: buffer.toString("base64"), mediaType } };
}
