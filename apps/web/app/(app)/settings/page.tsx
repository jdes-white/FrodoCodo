import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { prisma } from "@frodocodo/db";
import { fromPrismaDecimal } from "@/lib/decimal";
import { setAccountIncluded, disconnectInstitution } from "./actions";

export default async function SettingsPage() {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";

  const [household, connections, members] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: session.householdId } }),
    prisma.financialConnection.findMany({
      where: { householdId: session.householdId },
      include: { institution: true, accounts: true },
    }),
    prisma.householdMember.findMany({ where: { householdId: session.householdId }, include: { user: true } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Section title="Household">
        <Row label="Name" value={household.name} />
        <Row label="Budget cycle" value={formatCycle(household.defaultBudgetPeriodType, household.budgetAnchorDay)} />
        <Row label="Timezone" value={household.timezone} />
      </Section>

      <Section title="Members">
        {members.map((m) => (
          <Row key={m.id} label={m.user.name} value={m.role === "ADMIN" ? "Administrator" : "Household member"} />
        ))}
      </Section>

      <Section title="Connected accounts">
        {connections.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            No institutions connected yet.
          </p>
        )}
        {connections.map((conn) => (
          <div key={conn.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{conn.institution.name}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {conn.connectionMethod === "CDR" ? "Connected via Consumer Data Right" : "Connected via credential-based sync"}
                  {" · "}
                  {conn.isActive ? conn.consentStatus.toLowerCase() : "disconnected"}
                </p>
              </div>
              {isAdmin && conn.isActive && (
                <form action={disconnectInstitution}>
                  <input type="hidden" name="connectionId" value={conn.id} />
                  <button type="submit" className="text-xs" style={{ color: "var(--status-behind)" }}>
                    Disconnect
                  </button>
                </form>
              )}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {conn.accounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between text-sm">
                  <span>
                    {account.displayName}
                    {account.currentBalance !== null && (
                      <span style={{ color: "var(--color-text-muted)" }}> · {formatAUD(fromPrismaDecimal(account.currentBalance))}</span>
                    )}
                  </span>
                  {isAdmin ? (
                    <form action={setAccountIncluded} className="flex items-center gap-1.5">
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="included" value={account.isIncludedInBudget ? "" : "on"} />
                      <button type="submit" className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {account.isIncludedInBudget ? "Included" : "Excluded"}
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {account.isIncludedInBudget ? "Included" : "Excluded"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="AI & privacy">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          The AI coach only ever sees a small summary of your budget position — totals, bucket status, and
          period progress — never raw account numbers or your full transaction history. It runs on{" "}
          {process.env.AI_PROVIDER === "anthropic" ? "Anthropic Claude" : "a built-in deterministic summary (no external AI provider configured)"}.
          Core budgeting and the dashboard work fully even if the AI provider is unavailable.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border p-5"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function formatCycle(type: string, anchorDay: number | null): string {
  if (type === "CALENDAR_MONTH") return "Calendar month";
  if (type === "ANCHORED_MONTHLY") return `Monthly, anchored to day ${anchorDay}`;
  if (type === "FORTNIGHTLY") return "Fortnightly";
  return "Custom";
}
