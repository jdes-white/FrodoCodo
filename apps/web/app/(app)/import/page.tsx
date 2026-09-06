import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/PageHeader";
import { ImportScreenshotsForm } from "./ImportScreenshotsForm";
import { RecentImportBatches } from "./RecentImportBatches";
import { getRecentImportBatches } from "@/lib/importBatches";

const RECENT_BATCH_LIMIT = 5;

export default async function ImportPage() {
  const session = await requireSession();
  const recentBatches = await getRecentImportBatches(session.householdId, RECENT_BATCH_LIMIT);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import from screenshots" />
      <ImportScreenshotsForm />
      <RecentImportBatches batches={recentBatches} />
    </div>
  );
}
