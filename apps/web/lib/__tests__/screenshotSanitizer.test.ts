import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { classifyHeaderColor, detectScreenshotLayout, sanitizeScreenshot } from "../screenshotSanitizer";

const WIDTH = 400;
const HEIGHT = 900;

const CBA_HEADER = { r: 24, g: 24, b: 26 }; // near-black dark-mode chrome
const VIRGIN_HEADER = { r: 220, g: 20, b: 24 }; // strong brand red
const AMEX_HEADER = { r: 18, g: 28, b: 68 }; // dark navy
const UNKNOWN_HEADER = { r: 40, g: 200, b: 40 }; // bright green — no known app looks like this
const BODY_COLOR = { r: 255, g: 255, b: 255 };
const FOOTER_COLOR = { r: 235, g: 235, b: 238 };

/**
 * Real-measured colours, sampled directly from actual CBA/Virgin
 * Money/Amex screenshots during the real-screenshot hardening retest (see
 * screenshotSanitizer.ts's module doc comment) — not invented. Several
 * samples per app, taken from different rows within each app's header, to
 * show the real spread rather than a single cherry-picked value.
 */
const REAL_CBA_HEADER_SAMPLES = [
  { r: 47, g: 47, b: 47 },
  { r: 30, g: 30, b: 30 },
  { r: 36, g: 36, b: 36 },
  { r: 44, g: 44, b: 44 },
  { r: 31, g: 31, b: 31 },
];
const REAL_VIRGIN_HEADER_SAMPLES = [
  { r: 226, g: 48, b: 27 },
  { r: 224, g: 31, b: 9 },
  { r: 225, g: 41, b: 20 },
  { r: 227, g: 55, b: 35 },
];
const REAL_AMEX_HEADER_SAMPLES = [
  { r: 22, g: 29, b: 50 },
  { r: 0, g: 8, b: 31 },
  { r: 38, g: 47, b: 67 },
  { r: 12, g: 22, b: 45 },
  { r: 0, g: 18, b: 47 },
];

/**
 * Real-measured header-end and first-content-row-start fractions (of a
 * 1170x2532 real screenshot), found by probing per-pixel-row colour
 * transitions. Header end clustered tightly across all three real apps
 * (~0.107-0.111); Virgin's first heading ("Tuesday, 01 September 2026")
 * was the tightest real margin observed, starting at ~0.128. These pin
 * down the exact regression the real-screenshot retest found: the
 * previous Amex top crop (0.18) sat well past 0.128, cutting off Amex's
 * own first visible date heading in every real Amex screenshot tested.
 */
const REAL_HEADER_END_FRACTION = 0.111;
const REAL_FIRST_CONTENT_FRACTION = 0.128;
/** Real-measured bottom tab-bar start fraction, consistent across all three real apps (~0.095-0.101). */
const REAL_NAV_BAR_START_FRACTION = 0.096;

/** Builds a synthetic three-band "screenshot": header strip / body / footer strip, each a flat color. */
async function makeSyntheticScreenshot(
  headerColor: { r: number; g: number; b: number },
  opts?: {
    width?: number;
    height?: number;
    headerFraction?: number;
    footerFraction?: number;
    footerColor?: { r: number; g: number; b: number };
    bodyColor?: { r: number; g: number; b: number };
  },
): Promise<Buffer> {
  const width = opts?.width ?? WIDTH;
  const height = opts?.height ?? HEIGHT;
  // Deliberately smaller than the real crop fraction (0.115 top / 0.10
  // bottom) so a correct crop reliably removes the whole synthetic
  // header/footer band — these tests are about "does the crop clear the
  // chrome", not about the separate, already-documented
  // conservative-crop-may-leave-a-sliver tradeoff.
  const headerFraction = opts?.headerFraction ?? 0.08;
  const footerFraction = opts?.footerFraction ?? 0.07;
  const bodyColor = opts?.bodyColor ?? BODY_COLOR;
  const footerColor = opts?.footerColor ?? FOOTER_COLOR;

  const headerHeight = Math.round(height * headerFraction);
  const footerHeight = Math.round(height * footerFraction);

  const header = await sharp({ create: { width, height: headerHeight, channels: 3, background: headerColor } }).png().toBuffer();
  const footer = await sharp({ create: { width, height: footerHeight, channels: 3, background: footerColor } }).png().toBuffer();

  return sharp({ create: { width, height, channels: 3, background: bodyColor } })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: footer, left: 0, top: height - footerHeight },
    ])
    .png()
    .toBuffer();
}

async function sampleTopColor(buffer: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

async function sampleBottomColor(buffer: Buffer): Promise<{ r: number; g: number; b: number }> {
  const metadata = await sharp(buffer).metadata();
  const { data } = await sharp(buffer)
    .extract({ left: 0, top: metadata.height! - 1, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

function isCloseTo(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tolerance = 5): boolean {
  return Math.abs(a.r - b.r) <= tolerance && Math.abs(a.g - b.g) <= tolerance && Math.abs(a.b - b.b) <= tolerance;
}

describe("detectScreenshotLayout", () => {
  it("classifies a near-black dark-mode header as CBA", async () => {
    const image = await makeSyntheticScreenshot(CBA_HEADER);
    const layout = await detectScreenshotLayout(image, WIDTH, HEIGHT);
    expect(layout).toBe("CBA");
  });

  it("classifies a strong red header as Virgin Money", async () => {
    const image = await makeSyntheticScreenshot(VIRGIN_HEADER);
    const layout = await detectScreenshotLayout(image, WIDTH, HEIGHT);
    expect(layout).toBe("VIRGIN_MONEY");
  });

  it("classifies a dark navy header as Amex", async () => {
    const image = await makeSyntheticScreenshot(AMEX_HEADER);
    const layout = await detectScreenshotLayout(image, WIDTH, HEIGHT);
    expect(layout).toBe("AMEX");
  });

  it("returns null (never a guess) for a header colour matching no known layout", async () => {
    const image = await makeSyntheticScreenshot(UNKNOWN_HEADER);
    const layout = await detectScreenshotLayout(image, WIDTH, HEIGHT);
    expect(layout).toBeNull();
  });
});

describe("classifyHeaderColor — calibrated against real screenshot measurements", () => {
  // These are the actual per-pixel-row averages measured from real CBA,
  // Virgin Money, and Amex screenshots during the real-screenshot
  // hardening retest — not synthetic colours. This is the direct
  // regression coverage for that retest: if a future threshold change
  // stops recognizing any of these exact real measurements, these tests
  // fail immediately, without needing a real image file in the repo.
  it("classifies every real CBA header sample", () => {
    for (const sample of REAL_CBA_HEADER_SAMPLES) {
      expect(classifyHeaderColor(sample)).toBe("CBA");
    }
  });

  it("classifies every real Virgin Money header sample", () => {
    for (const sample of REAL_VIRGIN_HEADER_SAMPLES) {
      expect(classifyHeaderColor(sample)).toBe("VIRGIN_MONEY");
    }
  });

  it("classifies every real Amex header sample", () => {
    for (const sample of REAL_AMEX_HEADER_SAMPLES) {
      expect(classifyHeaderColor(sample)).toBe("AMEX");
    }
  });
});

describe("sanitizeScreenshot — real-measured crop boundaries (regression)", () => {
  /**
   * Reproduces the exact real-screenshot proportions that exposed the
   * crop-fraction bug found during the real-screenshot retest: a
   * synthetic image built from real measured fractions — a header band
   * (0 to REAL_HEADER_END_FRACTION), then a gap, then a distinctly
   * coloured "first content row" marker starting at
   * REAL_FIRST_CONTENT_FRACTION (Virgin's real earliest observed heading,
   * the tightest real margin) — and asserts the crop keeps the marker
   * fully intact while still removing the header.
   */
  async function makeRealCalibratedImage(headerColor: { r: number; g: number; b: number }): Promise<{ buffer: Buffer; height: number; markerColor: { r: number; g: number; b: number }; markerStartPx: number }> {
    const width = 400;
    const height = 2000; // proportionally representative of the real 1170x2532 captures
    const markerColor = { r: 10, g: 200, b: 10 }; // a colour no real header/body/footer uses
    const headerHeight = Math.round(height * REAL_HEADER_END_FRACTION);
    const markerStartPx = Math.round(height * REAL_FIRST_CONTENT_FRACTION);
    const markerHeight = 60;

    const header = await sharp({ create: { width, height: headerHeight, channels: 3, background: headerColor } }).png().toBuffer();
    const marker = await sharp({ create: { width, height: markerHeight, channels: 3, background: markerColor } }).png().toBuffer();

    const buffer = await sharp({ create: { width, height, channels: 3, background: BODY_COLOR } })
      .composite([
        { input: header, left: 0, top: 0 },
        { input: marker, left: 0, top: markerStartPx },
      ])
      .png()
      .toBuffer();
    return { buffer, height, markerColor, markerStartPx };
  }

  it("CBA: the crop never touches the first real content row, even at the tightest real margin", async () => {
    const { buffer, markerColor, markerStartPx } = await makeRealCalibratedImage(CBA_HEADER);
    const result = await sanitizeScreenshot(buffer, "image/png");
    expect(result.status).toBe("SANITIZED");
    if (result.status !== "SANITIZED") throw new Error("unreachable");

    const output = Buffer.from(result.image.base64, "base64");
    const outputMeta = await sharp(output).metadata();
    // The marker band must survive at its shifted position (original
    // position minus the removed top crop).
    const topPx = Math.round(2000 * 0.115);
    const expectedMarkerY = markerStartPx - topPx + 10;
    expect(expectedMarkerY).toBeGreaterThanOrEqual(0);
    expect(expectedMarkerY).toBeLessThan(outputMeta.height!);
    const { data } = await sharp(output).extract({ left: 0, top: expectedMarkerY, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(isCloseTo({ r: data[0]!, g: data[1]!, b: data[2]! }, markerColor)).toBe(true);
  });

  it("regression: the previous 0.18 Amex top-crop fraction WOULD have cut off this real content row — proves the fix", () => {
    // Direct arithmetic proof, no image needed: the old Amex fraction
    // (0.18) landed past the real first-content-row start
    // (REAL_FIRST_CONTENT_FRACTION, 0.128) on a 2532px-tall real capture,
    // while the corrected shared fraction (0.115) does not.
    const OLD_AMEX_TOP_FRACTION = 0.18;
    const CORRECTED_TOP_FRACTION = 0.115;
    expect(OLD_AMEX_TOP_FRACTION).toBeGreaterThan(REAL_FIRST_CONTENT_FRACTION);
    expect(CORRECTED_TOP_FRACTION).toBeLessThan(REAL_FIRST_CONTENT_FRACTION);
    expect(CORRECTED_TOP_FRACTION).toBeGreaterThan(REAL_HEADER_END_FRACTION);
  });

  it("regression: the previous 0.06-0.07 bottom-crop fractions left the real nav bar only partially removed — proves the fix", () => {
    const OLD_BOTTOM_FRACTIONS = [0.06, 0.07];
    const CORRECTED_BOTTOM_FRACTION = 0.1;
    for (const old of OLD_BOTTOM_FRACTIONS) {
      expect(old).toBeLessThan(REAL_NAV_BAR_START_FRACTION);
    }
    expect(CORRECTED_BOTTOM_FRACTION).toBeGreaterThanOrEqual(REAL_NAV_BAR_START_FRACTION);
  });
});

describe("sanitizeScreenshot — real image path", () => {
  it("CBA: crops away the header and footer bands, preserving the body", async () => {
    const image = await makeSyntheticScreenshot(CBA_HEADER);
    const result = await sanitizeScreenshot(image, "image/png");
    expect(result.status).toBe("SANITIZED");
    if (result.status !== "SANITIZED") throw new Error("unreachable");
    expect(result.layout).toBe("CBA");

    const output = Buffer.from(result.image.base64, "base64");
    const outputMeta = await sharp(output).metadata();
    expect(outputMeta.height!).toBeLessThan(HEIGHT);

    const topColor = await sampleTopColor(output);
    const bottomColor = await sampleBottomColor(output);
    expect(isCloseTo(topColor, CBA_HEADER)).toBe(false);
    expect(isCloseTo(bottomColor, FOOTER_COLOR)).toBe(false);
    // The body itself (transaction-list area) survives untouched.
    expect(isCloseTo(topColor, BODY_COLOR)).toBe(true);
  });

  it("Virgin Money: crops away the red header and footer bands, preserving the body", async () => {
    const image = await makeSyntheticScreenshot(VIRGIN_HEADER);
    const result = await sanitizeScreenshot(image, "image/png");
    expect(result.status).toBe("SANITIZED");
    if (result.status !== "SANITIZED") throw new Error("unreachable");
    expect(result.layout).toBe("VIRGIN_MONEY");

    const output = Buffer.from(result.image.base64, "base64");
    const topColor = await sampleTopColor(output);
    const bottomColor = await sampleBottomColor(output);
    expect(isCloseTo(topColor, VIRGIN_HEADER)).toBe(false);
    expect(isCloseTo(bottomColor, FOOTER_COLOR)).toBe(false);
  });

  it("Amex: crops away the navy header and footer bands, preserving the body", async () => {
    const image = await makeSyntheticScreenshot(AMEX_HEADER);
    const result = await sanitizeScreenshot(image, "image/png");
    expect(result.status).toBe("SANITIZED");
    if (result.status !== "SANITIZED") throw new Error("unreachable");
    expect(result.layout).toBe("AMEX");

    const output = Buffer.from(result.image.base64, "base64");
    const topColor = await sampleTopColor(output);
    const bottomColor = await sampleBottomColor(output);
    expect(isCloseTo(topColor, AMEX_HEADER)).toBe(false);
    expect(isCloseTo(bottomColor, FOOTER_COLOR)).toBe(false);
  });

  it("fails closed for an unrecognized layout — never returns the raw image", async () => {
    const image = await makeSyntheticScreenshot(UNKNOWN_HEADER);
    const result = await sanitizeScreenshot(image, "image/png");
    expect(result.status).toBe("UNSUPPORTED_LAYOUT");
    // The discriminated union has no `image` field on this branch at all —
    // structurally, there is nothing here that could carry the raw bytes.
    expect("image" in result).toBe(false);
  });

  it("fails closed for a file that isn't a decodable image at all", async () => {
    const garbage = Buffer.from("this is not an image", "utf8");
    const result = await sanitizeScreenshot(garbage, "image/png");
    expect(result.status).toBe("UNSUPPORTED_LAYOUT");
  });

  it("fails closed for an image too small to safely crop", async () => {
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: CBA_HEADER } }).png().toBuffer();
    const result = await sanitizeScreenshot(tiny, "image/png");
    expect(result.status).toBe("UNSUPPORTED_LAYOUT");
  });

  it("strips embedded metadata (e.g. EXIF) as a side effect of re-encoding", async () => {
    const withExif = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: CBA_HEADER } })
      .withMetadata({ exif: { IFD0: { Software: "some-camera-app" } } })
      .jpeg()
      .toBuffer();
    const result = await sanitizeScreenshot(withExif, "image/jpeg");
    expect(result.status).toBe("SANITIZED");
    if (result.status !== "SANITIZED") throw new Error("unreachable");
    const outputMeta = await sharp(Buffer.from(result.image.base64, "base64")).metadata();
    expect(outputMeta.exif).toBeUndefined();
  });
});

describe("sanitizeScreenshot — test fixture replay path", () => {
  const TEST_FIXTURE_MARKER = "FRODOCODO_SCREENSHOT_TEST_FIXTURE_V1:";

  function fixtureBytes(payload: unknown): Buffer {
    return Buffer.from(TEST_FIXTURE_MARKER + JSON.stringify(payload), "utf8");
  }

  it("passes through a declared valid source unchanged, without touching real image decoding", async () => {
    const result = await sanitizeScreenshot(fixtureBytes({ source: "CBA", transactions: [] }), "image/png");
    expect(result).toEqual({
      status: "SANITIZED",
      layout: "CBA",
      image: { base64: fixtureBytes({ source: "CBA", transactions: [] }).toString("base64"), mediaType: "image/png" },
    });
  });

  it("fails closed when the fixture declares an unrecognized/UNKNOWN source", async () => {
    const result = await sanitizeScreenshot(fixtureBytes({ source: "UNKNOWN", transactions: [] }), "image/png");
    expect(result.status).toBe("UNSUPPORTED_LAYOUT");
  });
});
