"use client";

import { useState } from "react";
import Link from "next/link";
import { CommitmentCard, type CommitmentCardData } from "@/app/(app)/commitments/CommitmentCard";
import { AddCommitmentCard } from "@/app/(app)/commitments/AddCommitmentCard";
import type { CategoryOption } from "@/app/(app)/commitments/CommitmentFormFields";
import { BottomSheet } from "./BottomSheet";

const MUTED = { color: "var(--color-text-muted)" } as const;

export interface BucketUpcomingData {
  /** Pre-formatted total (`formatAUD` of the window summary) — money
   * formatting stays a web/shared concern, not this component's. */
  totalDisplay: string;
  /** e.g. "due tomorrow" / "due in 4 days" / "due in the next 7 days" —
   * null when nothing in this bucket is due within the window, in which
   * case no due-line renders at all (the bucket card looks exactly as it
   * did before this feature). */
  phrase: string | null;
  /** Sorted soonest-first, already scoped to this bucket's categories. */
  items: CommitmentCardData[];
  /** The bucket's first category by sort order — a reasonable default for
   * "+ Add commitment" from this bucket's expanded view, since a bucket can
   * span several categories and there's no single unambiguous one to pick;
   * the select stays fully editable. */
  defaultCategoryId: string | undefined;
}

/**
 * The interactive half of the Home Page 2 bucket-card integration: the
 * compact due line plus its tap-to-expand bottom sheet. Split out from
 * BucketCard.tsx specifically so BucketCard itself can stay a server
 * component — it renders `pacing.remaining`/`pacing.percentConsumed`,
 * which are `Decimal` instances (CLAUDE.md rule #3), and a plain object
 * crossing a server→client boundary as a prop loses its prototype (its
 * methods like `.isZero()`/`.dividedBy()` disappear, breaking
 * derivePaceStatusFromPacing). Everything this component receives is already
 * plain serializable data — strings, numbers, `CommitmentCardData`/
 * `CategoryOption` objects with no Decimal or Date fields — so the
 * boundary is safe here.
 */
export function BucketDueLine({
  bucketName,
  upcoming,
  categories,
}: {
  bucketName: string;
  upcoming: BucketUpcomingData;
  categories: CategoryOption[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  if (upcoming.phrase === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="flex items-center gap-1.5 text-left text-xs font-medium"
        style={{ color: "var(--color-accent)" }}
      >
        <span aria-hidden>📅</span>
        <span className="min-w-0 flex-1 truncate">
          {upcoming.totalDisplay} {upcoming.phrase}
        </span>
        <span aria-hidden>{sheetOpen ? "︿" : "›"}</span>
      </button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div>
          <h3 className="text-base font-bold">Upcoming in {bucketName}</h3>
          <p className="text-xs" style={MUTED}>
            {upcoming.totalDisplay} total in the next 7 days
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {upcoming.items.map((item) => (
            <CommitmentCard key={item.id} commitment={item} categories={categories} />
          ))}
        </div>

        <AddCommitmentCard categories={categories} defaultCategoryId={upcoming.defaultCategoryId} label="+ Add commitment" />

        <Link
          href="/commitments"
          onClick={() => setSheetOpen(false)}
          className="block pb-1 text-center text-sm font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          View all upcoming commitments
        </Link>
      </BottomSheet>
    </>
  );
}
