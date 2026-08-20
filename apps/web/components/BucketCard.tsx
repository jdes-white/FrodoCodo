import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import type { BucketSnapshot } from "@/lib/budgetSnapshot";
import { statusLabel, statusColorVar, statusSoftColorVar } from "@/lib/statusDisplay";
import { ProgressBar } from "./ProgressBar";
import { Card } from "./Card";
import { CategoryIcon } from "./CategoryIcon";
import { StatusPill } from "./StatusPill";

export function BucketCard({ bucket }: { bucket: BucketSnapshot }) {
  const { pacing } = bucket;
  return (
    <Link href={`/plan/buckets/${bucket.bucketId}`} className="block transition hover:opacity-90">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <CategoryIcon name={bucket.name} size={34} />
            <p className="truncate text-sm font-medium">{bucket.name}</p>
          </div>
          <StatusPill
            label={statusLabel(pacing.pacingStatus)}
            color={statusColorVar(pacing.pacingStatus)}
            soft={statusSoftColorVar(pacing.pacingStatus)}
          />
        </div>
        <p className="mt-3 text-lg font-semibold">{formatAUD(pacing.remaining)} left</p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {formatAUD(pacing.spentToDate)} of {formatAUD(pacing.allocation)}
        </p>
        <div className="mt-3">
          <ProgressBar percent={pacing.percentConsumed} colorVar={statusColorVar(pacing.pacingStatus)} />
        </div>
      </Card>
    </Link>
  );
}
