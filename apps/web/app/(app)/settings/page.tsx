import { requireSession } from "@/lib/session";
import { prisma } from "@frodocodo/db";
import { createFinancialProvider } from "@frodocodo/providers";
import { getHousehold } from "@/lib/household";
import { withRouteTiming } from "@/lib/perf";
import { setAccountIncluded, disconnectInstitution, connectInstitution } from "./actions";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";
  const { connected } = await searchParams;

  const [household, connections, members, supportedInstitutions] = await withRouteTiming("/settings", () =>
    Promise.all([
      getHousehold(session.householdId),
      prisma.financialConnection.findMany({
        where: { householdId: session.householdId },
        include: { institution: true, accounts: true },
      }),
      prisma.householdMember.findMany({ where: { householdId: session.householdId }, include: { user: true } }),
      createFinancialProvider().listSupportedInstitutions(),
    ]),
  );

  const activeProviderInstitutionIds = new Set(
    connections.filter((c) => c.isActive).map((c) => c.institution.providerInstitutionId),
  );
  const connectableInstitutions = supportedInstitutions.filter((i) => !activeProviderInstitutionIds.has(i.providerInstitutionId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />

      {connected === "success" && (
        <div className="rounded-md p-3 text-sm" style={{ background: "var(--status-ahead-soft)", color: "var(--status-ahead)" }}>
          Institution connected. Your accounts and transactions are syncing now.
        </div>
      )}
      {connected === "error" && (
        <div className="rounded-md p-3 text-sm" style={{ background: "var(--status-behind-soft)", color: "var(--status-behind)" }}>
          We couldn&apos;t complete that connection. Nothing was changed — you can try again below.
        </div>
      )}

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
          <div
            key={conn.id}
            data-testid={`connection-${conn.id}`}
            data-connection-status={conn.isActive ? conn.consentStatus : "DISCONNECTED"}
            className="border-t pt-3 first:border-t-0 first:pt-0"
            style={{ borderColor: "var(--color-border)" }}
          >
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
                  <span>{account.alias}</span>
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

      {isAdmin && connectableInstitutions.length > 0 && (
        <Section title="Connect an institution">
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            FrodoCodo never sees your account number, BSB, balance, or bank login — only account discovery and
            transactions, read-only.
          </p>
          <div className="mt-1 flex flex-col gap-2">
            {connectableInstitutions.map((institution) => (
              <form
                key={institution.providerInstitutionId}
                action={connectInstitution}
                className="flex items-center justify-between"
              >
                <input type="hidden" name="providerInstitutionId" value={institution.providerInstitutionId} />
                <span className="text-sm">{institution.name}</span>
                <button type="submit" className="text-xs font-medium" style={{ color: "var(--status-ahead)" }}>
                  Connect
                </button>
              </form>
            ))}
          </div>
        </Section>
      )}

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
    <Card as="section" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </Card>
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
