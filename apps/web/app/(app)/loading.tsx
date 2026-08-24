/**
 * Route-level Suspense fallback for every primary destination under
 * (app) — Next.js shows this instantly while a page's async data-fetch
 * (a DB round-trip in every case here) is still in flight, instead of
 * leaving the screen blank/frozen until the whole page resolves. The
 * layout (NavBar, header) already stays mounted around whatever's in
 * `{children}`, so the app shell and bottom navigation never move — only
 * this content area swaps in once the real page is ready.
 *
 * One shared skeleton rather than a bespoke one per route: every primary
 * page is fundamentally "a heading plus a few cards," so a generic
 * pulsing card stack reads as "this is loading" everywhere without
 * needing six near-identical files.
 */
export default function AppLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-hidden>
      <div className="h-6 w-32 rounded-lg" style={{ background: "var(--color-border)" }} />
      <div className="h-28 w-full rounded-2xl" style={{ background: "var(--color-border)" }} />
      <div className="h-16 w-full rounded-2xl" style={{ background: "var(--color-border)" }} />
      <div className="h-16 w-full rounded-2xl" style={{ background: "var(--color-border)" }} />
    </div>
  );
}
