import { Card } from "@/components/Card";
import type { ImportBatchSummary } from "@/lib/importBatches";

/**
 * Screenshot-to-budget closure pass: the durable counterpart to
 * `ImportScreenshotsForm`'s immediate, in-memory result — this renders
 * fresh from the database on every page load, so a household member who
 * uploaded a batch, navigated to Settings, and came back (or reloaded, or
 * reopened the app) can still see exactly what happened to it. Reuses the
 * existing card/list pattern rather than introducing a reporting dashboard.
 */
export function RecentImportBatches({ batches }: { batches: ImportBatchSummary[] }) {
  if (batches.length === 0) return null;

  return (
    <Card as="section" className="flex flex-col gap-4">
      <h2 className="text-sm font-medium">Recent imports</h2>
      <ul className="flex flex-col gap-4">
        {batches.map((batch) => (
          <li
            key={batch.id}
            data-testid="import-batch"
            data-batch-id={batch.id}
            className="rounded-xl border p-4 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          >
            <BatchRow batch={batch} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BatchRow({ batch }: { batch: ImportBatchSummary }) {
  const createdRowCount = batch.transactionsFound - batch.alreadyKnownCount;
  const outcomes = batch.outcomeCounts;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {new Date(batch.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}
      </p>

      <p style={{ color: "var(--color-text-muted)" }}>
        {batch.screenshotsProcessed} screenshot{batch.screenshotsProcessed === 1 ? "" : "s"} processed
      </p>
      <p style={{ color: "var(--color-text-muted)" }}>
        {batch.sourcesDetected.length} source{batch.sourcesDetected.length === 1 ? "" : "s"} detected
        {batch.sourcesDetected.length > 0 ? ` (${batch.sourcesDetected.join(", ")})` : ""}
      </p>
      <p style={{ color: "var(--color-text-muted)" }}>
        {batch.transactionsFound} transaction{batch.transactionsFound === 1 ? "" : "s"} found
      </p>

      <ul className="flex flex-col gap-1" style={{ color: "var(--color-text-muted)" }}>
        {outcomes.CATEGORISED > 0 && <li>{outcomes.CATEGORISED} categorised automatically</li>}
        {batch.alreadyKnownCount > 0 && <li>{batch.alreadyKnownCount} already known</li>}
        {outcomes.EXCLUDED_NON_SPEND > 0 && <li>{outcomes.EXCLUDED_NON_SPEND} excluded as income/transfer</li>}
        {outcomes.CATEGORY_REVIEW > 0 && <li>{outcomes.CATEGORY_REVIEW} need a category</li>}
        {outcomes.FINANCIAL_MOVEMENT_REVIEW > 0 && <li>{outcomes.FINANCIAL_MOVEMENT_REVIEW} might not be spending — review needed</li>}
        {outcomes.POSSIBLE_DUPLICATE > 0 && <li>{outcomes.POSSIBLE_DUPLICATE} possible duplicate{outcomes.POSSIBLE_DUPLICATE === 1 ? "" : "s"}</li>}
        {outcomes.LOW_CONFIDENCE_EXTRACTION > 0 && <li>{outcomes.LOW_CONFIDENCE_EXTRACTION} low-confidence read{outcomes.LOW_CONFIDENCE_EXTRACTION === 1 ? "" : "s"}</li>}
        {batch.unreadableTransactionCount > 0 && (
          <li style={{ color: "var(--status-behind)" }}>{batch.unreadableTransactionCount} row(s) could not be reliably read</li>
        )}
        {batch.screenshotsUnrecognized > 0 && (
          <li style={{ color: "var(--status-behind)" }}>
            {batch.screenshotsUnrecognized} screenshot{batch.screenshotsUnrecognized === 1 ? "" : "s"} couldn&apos;t be read
          </li>
        )}
      </ul>

      {createdRowCount > 0 && (
        <a
          href={`/transactions?importBatchId=${batch.id}`}
          className="mt-1 inline-block text-sm font-medium"
          style={{ color: "var(--color-accent)" }}
        >
          View these transactions →
        </a>
      )}
    </div>
  );
}
