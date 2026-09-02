import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/PageHeader";
import { ImportScreenshotsForm } from "./ImportScreenshotsForm";

export default async function ImportPage() {
  await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import from screenshots" />
      <ImportScreenshotsForm />
    </div>
  );
}
