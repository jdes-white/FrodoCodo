import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { deriveSpendPaceStatus, spendPaceLabel } from "@frodocodo/domain";
import type { BucketSnapshot } from "@/lib/budgetSnapshot";
import { spendPaceColorVar, spendPaceSoftColorVar } from "@/lib/statusDisplay";
import { ProgressBar } from "./ProgressBar";
import { Card } from "./Card";
import { CategoryIcon } from "./CategoryIcon";
import { StatusPill } from "./StatusPill";

/**
 * A single compact row: icon + name + amount remaining on top, status pill
 * + progress bar underneath. Sized for Home's Panel 2, where all of a
 * household's buckets (currently four) need to fit one viewport with no
 * scrolling — the progress bar (not text) absorbs whatever width is left
 * after the status pill, so a longer label like "Comfortably on track"
 * never risks overflowing the row the way constraining two text elements
 * to share a line would.
 */
export function BucketCard({ bucket }: { bucket: BucketSnapshot }) {
  const { pacing } = bucket;
  const status = deriveSpendPaceStatus(pacing);
  const color = spendPaceColorVar(status);
  const soft = spendPaceSoftColorVar(status);

  return (
    <Link href={`/plan/buckets/${bucket.bucketId}`} className="block transition hover:opacity-90">
      <Card padding="p-2" className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <CategoryIcon name={bucket.name} size={22} />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{bucket.name}</p>
          <p className="shrink-0 text-sm font-semibold">{formatAUD(pacing.remaining)} left</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label={spendPaceLabel(status)} color={color} soft={soft} />
          <div className="min-w-0 flex-1">
            <ProgressBar percent={pacing.percentConsumed} colorVar={color} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
