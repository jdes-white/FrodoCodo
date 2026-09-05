"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { todayUTC } from "@frodocodo/shared";
import { Card } from "@/components/Card";
import { addCommitment } from "./actions";
import { CommitmentFormFields, type CategoryOption } from "./CommitmentFormFields";

/**
 * The "add a commitment" control — collapsed to a single tappable pill so
 * the page opens straight onto the existing list, expanding into the same
 * field set CommitmentCard's editor uses. Resets to blank (not just
 * collapses) after a successful add, ready for the next entry.
 *
 * `defaultCategoryId` lets a caller (the Home Page 2 bucket expanded view)
 * preselect a sensible starting category — e.g. the bucket's first category
 * by sort order — while leaving the dropdown fully editable, since a bucket
 * can contain several categories and there's no single unambiguous one to
 * default to.
 */
export function AddCommitmentCard({ categories, defaultCategoryId, label = "+ Add a commitment" }: { categories: CategoryOption[]; defaultCategoryId?: string; label?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="block w-full text-left">
        <Card padding="p-3" className="text-center text-sm font-semibold">
          <span style={{ color: "var(--color-accent)" }}>{label}</span>
        </Card>
      </button>
    );
  }

  return <ExpandedAddCommitmentCard categories={categories} defaultCategoryId={defaultCategoryId} onDone={() => setExpanded(false)} />;
}

function ExpandedAddCommitmentCard({
  categories,
  defaultCategoryId,
  onDone,
}: {
  categories: CategoryOption[];
  defaultCategoryId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [expectedDate, setExpectedDate] = useState(todayUTC());
  const [recurrence, setRecurrence] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [pending, setPending] = useState(false);

  async function handleAdd() {
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("name", name);
      formData.set("amount", amount);
      formData.set("expectedDate", expectedDate);
      formData.set("recurrence", recurrence);
      formData.set("categoryId", categoryId);
      await addCommitment(formData);
      router.refresh();
      onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padding="p-3" className="flex flex-col gap-3">
      <CommitmentFormFields
        name={name}
        amount={amount}
        expectedDate={expectedDate}
        recurrence={recurrence}
        categoryId={categoryId}
        categories={categories}
        onNameChange={setName}
        onAmountChange={setAmount}
        onExpectedDateChange={setExpectedDate}
        onRecurrenceChange={setRecurrence}
        onCategoryChange={setCategoryId}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={pending || !name.trim() || !(Number(amount) > 0) || !expectedDate || !categoryId}
          className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {pending ? "Adding…" : "Add commitment"}
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
    </Card>
  );
}
