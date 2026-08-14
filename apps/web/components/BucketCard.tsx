import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import type { BucketSnapshot } from "@/lib/budgetSnapshot";
import { statusLabel, statusColorVar, statusSoftColorVar } from "@/lib/statusDisplay";
import { ProgressBar } from "./ProgressBar";

export function BucketCard({ bucket }: { bucket: BucketSnapshot }) {
  const { pacing } = bucket;
  return (
    <Link
      href={`/plan/buckets/${bucket.bucketId}`}
      className="block rounded-2xl border p-4 transition hover:opacity-90"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{bucket.name}</p>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: statusSoftColorVar(pacing.pacingStatus), color: statusColorVar(pacing.pacingStatus) }}
        >
          {statusLabel(pacing.pacingStatus)}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold">{formatAUD(pacing.remaining)} left</p>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {formatAUD(pacing.spentToDate)} of {formatAUD(pacing.allocation)}
      </p>
      <div className="mt-3">
        <ProgressBar percent={pacing.percentConsumed} colorVar={statusColorVar(pacing.pacingStatus)} />
      </div>
    </Link>
  );
}
