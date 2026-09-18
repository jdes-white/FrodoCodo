import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FrodoCodo",
  description: "Household Financial Operating System",
};

/**
 * Without this, mobile browsers render the page at a virtual desktop-width
 * viewport (~980px) and scale the whole thing down to fit — the "feels
 * zoomed out, needs pinch-zoom and horizontal panning" symptom. This is
 * the app-wide fix for that; every page's layout already responds to
 * narrow widths via Tailwind's responsive utilities (no page-by-page
 * viewport hacks needed). `maximumScale` is deliberately left unset —
 * the requirement is that zooming isn't *required*, not that it's
 * disabled, which would be an accessibility regression for users who
 * rely on pinch-zoom.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
