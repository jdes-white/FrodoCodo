import { prisma } from "@frodocodo/db";
import { getProvider } from "./provider.js";
import { syncConnection } from "./syncConnection.js";
import { generateInsightsForHousehold } from "./generateInsights.js";

/**
 * Background sync/insight worker (§35 notification & ingestion layers).
 * A single always-on Node process running a simple interval loop — this is
 * the right size for a household-scale single-instance deployment (§7's
 * provider abstraction is what actually matters for correctness; the job
 * runner around it is deliberately unglamorous). Swap this loop for a real
 * queue (pg-boss/BullMQ) if this ever needs to run as multiple instances.
 *
 * The dashboard never depends on this process being up (§44) — it always
 * reads the last synced state directly from Postgres.
 */

const SYNC_INTERVAL_MS = Number(process.env.WORKER_SYNC_INTERVAL_MINUTES ?? 60) * 60_000;

async function runSyncCycle(): Promise<void> {
  const provider = getProvider();
  const connections = await prisma.financialConnection.findMany({ where: { isActive: true } });

  for (const connection of connections) {
    try {
      await syncConnection(provider, connection.id);
      console.log(`[worker] synced connection ${connection.id}`);
    } catch (err) {
      console.error(`[worker] sync failed for connection ${connection.id}:`, err);
    }
  }

  const households = await prisma.household.findMany({ select: { id: true } });
  for (const household of households) {
    try {
      const count = await generateInsightsForHousehold(household.id);
      console.log(`[worker] generated ${count} insight(s) for household ${household.id}`);
    } catch (err) {
      console.error(`[worker] insight generation failed for household ${household.id}:`, err);
    }
  }
}

async function main() {
  console.log(`[worker] starting — sync interval ${SYNC_INTERVAL_MS / 60_000} minute(s)`);
  await runSyncCycle();
  const interval = setInterval(() => {
    runSyncCycle().catch((err) => console.error("[worker] cycle error:", err));
  }, SYNC_INTERVAL_MS);

  const shutdown = async () => {
    console.log("[worker] shutting down");
    clearInterval(interval);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exitCode = 1;
});
