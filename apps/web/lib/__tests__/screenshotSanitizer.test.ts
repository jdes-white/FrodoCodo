import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectScreenshotLayout, sanitizeScreenshot } from "../screenshotSanitizer";

const WIDTH = 400;
const HEIGHT = 900;

const CBA_HEADER = { r: 24, g: 24, b: 26 }; // near-black dark-mode chrome
const VIRGIN_HEADER = { r: 220, g: 20, b: 24 }; // strong brand red
const AMEX_HEADER = { r: 18, g: 28, b: 68 }; // dark navy
const UNKNOWN_HEADER = { r: 40, g: 200, b: 40 }; // bright green — no known app looks like this
const BODY_COLOR = { r: 255, g: 255, b: 255 };
const FOOTER_COLOR = { r: 235, g: 235, b: 238 };

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
  // Deliberately smaller than every layout's actual crop fraction (the
  // smallest configured is CBA's 0.14 top / 0.06 bottom) so a correct crop
  // reliably removes the whole synthetic header/footer band — these tests
  // are about "does the crop clear the chrome", not about the separate,
  // already-documented conservative-crop-may-leave-a-sliver tradeoff.
  const headerFraction = opts?.headerFraction ?? 0.1;
  const footerFraction = opts?.footerFraction ?? 0.05;
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
