"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { updateCommitment, deleteCommitment, completeCommitment } from "./actions";
import { CommitmentFormFields } from "./CommitmentFormFields";

const MUTED = { color: "var(--color-text-muted)" } as const;
const RECURRENCE_LABEL: Record<string, string> = { WEEKLY: "Weekly", FORTNIGHTLY: "Fortnightly", MONTHLY: "Monthly" };

export interface CommitmentCardData {
  id: string;
  name: string;
  amount: number;
  amountDisplay: string;
  expectedDate: string; // "YYYY-MM-DD"
  dateDisplay: string;
  recurrence: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | null;
  completedAt: string | null;
}

/**
 * A single tracked commitment (§3): tapping the compact row expands it in
 * place into an edit form with Save / Mark paid / Remove — no separate
 * settings page, matching the "tap the item to manage it" instruction.
 * Same fire-and-forget-then-refresh pattern as North Star's
 * TilePair.tsx (call the server action directly, router.refresh() to pick
 * up the revalidated data, then collapse) rather than native form
 * submission, so this component controls exactly when it collapses back
 * to the compact view.
 */
export function CommitmentCard({ commitment }: { commitment: CommitmentCardData }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    const isCompleted = commitment.completedAt !== null;
    return (
      <button type="button" onClick={() => setExpanded(true)} className="block w-full text-left">
        <Card padding="p-3" className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {commitment.name}
              {commitment.recurrence && (
                <span
                  className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                >
                  {RECURRENCE_LABEL[commitment.recurrence]}
                </span>
              )}
            </p>
            <p className="text-xs" style={MUTED}>
              {isCompleted ? `Paid · ${commitment.dateDisplay}` : commitment.dateDisplay}
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold" style={isCompleted ? MUTED : undefined}>
            {commitment.amountDisplay}
          </p>
        </Card>
      </button>
    );
  }

  return <ExpandedCommitmentCard commitment={commitment} onDone={() => setExpanded(false)} />;
}

function ExpandedCommitmentCard({ commitment, onDone }: { commitment: CommitmentCardData; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(commitment.name);
  const [amount, setAmount] = useState(String(commitment.amount));
  const [expectedDate, setExpectedDate] = useState(commitment.expectedDate);
  const [recurrence, setRecurrence] = useState(commitment.recurrence ?? "");
  const [pending, setPending] = useState(false);
  const isCompleted = commitment.completedAt !== null;

  async function withPending(run: () => Promise<void>) {
    setPending(true);
    try {
      await run();
      router.refresh();
      onDone();
    } finally {
      setPending(false);
    }
  }

  function handleSave() {
    void withPending(async () => {
      const formData = new FormData();
      formData.set("id", commitment.id);
      formData.set("name", name);
      formData.set("amount", amount);
      formData.set("expectedDate", expectedDate);
      formData.set("recurrence", recurrence);
      await updateCommitment(formData);
    });
  }

  function handleComplete() {
    void withPending(async () => {
      const formData = new FormData();
      formData.set("id", commitment.id);
      await completeCommitment(formData);
    });
  }

  function handleDelete() {
    void withPending(async () => {
      const formData = new FormData();
      formData.set("id", commitment.id);
      await deleteCommitment(formData);
    });
  }

  return (
    <Card padding="p-3" className="flex flex-col gap-3">
      <CommitmentFormFields
        name={name}
        amount={amount}
        expectedDate={expectedDate}
        recurrence={recurrence}
        onNameChange={setName}
        onAmountChange={setAmount}
        onExpectedDateChange={setExpectedDate}
        onRecurrenceChange={setRecurrence}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim() || !(Number(amount) > 0) || !expectedDate}
          className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
          style={{ borderColor: "var(--color-border)" }}
        >
          Cancel
        </button>
      </div>

      <div className="flex gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        {!isCompleted && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={pending}
            className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--status-ahead-soft)", color: "var(--status-ahead)" }}
          >
            Mark paid
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="flex-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
          style={{ borderColor: "var(--status-off-track)", color: "var(--status-off-track)" }}
        >
          Remove
        </button>
      </div>
    </Card>
  );
}
