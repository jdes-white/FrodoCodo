import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { deriveSpendPaceStatus, spendPaceLabel } from "@frodocodo/domain";
import type { BucketSnapshot } from "@/lib/budgetSnapshot";
import { spendPaceColorVar, spendPaceSoftColorVar } from "@/lib/statusDisplay";
import type { CategoryOption } from "@/app/(app)/commitments/CommitmentFormFields";
import { ProgressBar } from "./ProgressBar";
import { Card } from "./Card";
import { CategoryIcon } from "./CategoryIcon";
import { StatusPill } from "./StatusPill";
import { BucketDueLine, type BucketUpcomingData } from "./BucketDueLine";

export type { BucketUpcomingData } from "./BucketDueLine";

/**
 * A single compact row: icon + name + amount remaining on top, status pill
 * + progress bar underneath — unchanged from before this feature. Sized
 * for Home's Panel 2, where all of a household's buckets (currently four)
 * need to fit one viewport with no scrolling — the progress bar (not text)
 * absorbs whatever width is left after the status pill, so a longer label
 * like "Comfortably on track" never risks overflowing the row the way
 * constraining two text elements to share a line would.
 *
 * Deliberately stays a server component: `pacing` carries `Decimal`
 * instances (CLAUDE.md rule #3), and only a server component can compute
 * from those directly — passing the raw pacing object into a client
 * component would serialize it into a plain object and silently strip its
 * methods. The actual due-line + bottom sheet is a separate client
 * component (BucketDueLine) that receives only already-formatted strings
 * and plain data, so the interactivity this feature needs never requires
 * Decimal to cross that boundary.
 *
 * When this bucket has upcoming commitments due within the look-ahead
 * window, a compact accent-colored line appears beneath (per the Home
 * Page 2 bucket-card integration spec) — tapping it opens a bottom sheet
 * with that bucket's due commitments, rather than expanding the card in
 * place, specifically so opening it can never grow Panel 2's own height
 * past one viewport (see BottomSheet.tsx's doc comment). The due line and
 * the bucket-detail link are separate tap targets (siblings, not nested —
 * a <button> inside an <a> is invalid HTML) so both the existing "tap the
 * card to see this bucket's detail" behavior and the new "tap the due
 * line to see what's coming up" behavior work independently.
 */
export function BucketCard({
  bucket,
  upcoming,
  categories,
}: {
  bucket: BucketSnapshot;
  upcoming: BucketUpcomingData;
  categories: CategoryOption[];
}) {
  const { pacing } = bucket;
  const status = deriveSpendPaceStatus(pacing);
  const color = spendPaceColorVar(status);
  const soft = spendPaceSoftColorVar(status);

  return (
    <Card padding="p-3" className="flex flex-col gap-1.5">
      <Link href={`/plan/buckets/${bucket.bucketId}`} className="flex flex-col gap-1.5 transition hover:opacity-90">
        <div className="flex items-center gap-2">
          <CategoryIcon name={bucket.name} size={26} />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{bucket.name}</p>
          <p className="shrink-0 text-sm font-semibold">{formatAUD(pacing.remaining)} left</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label={spendPaceLabel(status)} color={color} soft={soft} />
          <div className="min-w-0 flex-1">
            <ProgressBar percent={pacing.percentConsumed} colorVar={color} />
          </div>
        </div>
      </Link>
      <BucketDueLine bucketName={bucket.name} upcoming={upcoming} categories={categories} />
    </Card>
  );
}
