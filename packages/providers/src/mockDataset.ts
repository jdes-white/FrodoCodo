import { toMoney, addDays, daysBetween } from "@frodocodo/shared";
import { createRng, pick, between, chance } from "./rng.js";
import type { ProviderAccount, ProviderTransaction } from "./types.js";

/**
 * Synthetic household dataset (§55) shaped like the three real target
 * products (CBA transaction account, Virgin Money Velocity High Flyer
 * credit card, Amex Velocity credit card) so the whole product can be built
 * and demoed without any real household financial data. Deterministic for
 * a given seed so tests and the seed script are reproducible.
 */

export const MOCK_ACCOUNT_IDS = {
  cbaTransaction: "mock-cba-transaction",
  virginCreditCard: "mock-virgin-velocity-cc",
  amexCreditCard: "mock-amex-velocity-cc",
} as const;

const GROCERY_MERCHANTS = ["WOOLWORTHS 2481 BRISBANE AU", "COLES 0092 BRISBANE AU", "ALDI STORES BRISBANE AU"];
const FUEL_MERCHANTS = ["BP BRISBANE AU", "SHELL COLES EXPRESS AU", "7-ELEVEN BRISBANE AU"];
const DINING_MERCHANTS = [
  "UBER EATS AU",
  "MENULOG SYDNEY AU",
  "MCDONALDS BRISBANE AU",
  "SQ *CORNER CAFE BRISBANE AU",
  "SP *RAMEN HOUSE",
];
const SHOPPING_MERCHANTS = ["KMART BRISBANE AU", "TARGET BRISBANE AU", "AMAZON AU", "JB HI-FI BRISBANE AU"];
const AMBIGUOUS_MERCHANTS = [
  "SP * FITNESSHUB4471",
  "PAYPAL *UNKNOWN9921",
  "SQ *POPUP MARKET",
  "PAYPAL *MKTPLACE773",
];

interface Subscription {
  description: string;
  amount: number;
  dayOfMonth: number;
  accountId: string;
}

const SUBSCRIPTIONS: Subscription[] = [
  { description: "NETFLIX.COM AU", amount: 24.99, dayOfMonth: 5, accountId: MOCK_ACCOUNT_IDS.virginCreditCard },
  { description: "SPOTIFY AU", amount: 12.99, dayOfMonth: 8, accountId: MOCK_ACCOUNT_IDS.virginCreditCard },
  { description: "AMAZON PRIME AU", amount: 9.99, dayOfMonth: 18, accountId: MOCK_ACCOUNT_IDS.amexCreditCard },
];

export interface GenerateDatasetOptions {
  seed?: number;
  monthsOfHistory?: number;
  asOfDate: string; // YYYY-MM-DD
}

export interface GeneratedDataset {
  accounts: ProviderAccount[];
  transactions: ProviderTransaction[];
}

export function generateHouseholdDataset(options: GenerateDatasetOptions): GeneratedDataset {
  const rng = createRng(options.seed ?? 42);
  const monthsOfHistory = options.monthsOfHistory ?? 4;
  const asOf = options.asOfDate;
  const startDate = addDays(asOf, -monthsOfHistory * 30);

  const transactions: ProviderTransaction[] = [];
  let idCounter = 1;
  const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

  // --- Income: fortnightly salary into the CBA transaction account ---
  for (let cursor = startDate; daysBetween(cursor, asOf) >= 0; cursor = addDays(cursor, 14)) {
    transactions.push(
      makeTx(nextId("sal"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, 2950, "CREDIT", "POSTED", "SALARY PAYMENT ACME PTY LTD"),
    );
  }

  // --- Fixed commitments, direct-debited from the CBA transaction account ---
  for (let cursor = startDate; daysBetween(cursor, asOf) >= 0; cursor = addDays(cursor, 1)) {
    const day = Number(cursor.slice(8, 10));
    if (day === 3) {
      transactions.push(makeTx(nextId("mtg"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, 2400, "DEBIT", "POSTED", "HOME LOAN REPAYMENT"));
    }
    if (day === 12) {
      transactions.push(makeTx(nextId("ins"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, 118.4, "DEBIT", "POSTED", "AAMI HOME CONTENTS INSURANCE"));
    }
    if (day === 16) {
      transactions.push(makeTx(nextId("energy"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, round2(between(rng, 190, 245)), "DEBIT", "POSTED", "ORIGIN ENERGY"));
    }
    if (day === 22) {
      transactions.push(makeTx(nextId("telco"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, 95, "DEBIT", "POSTED", "TELSTRA"));
    }
  }

  // --- Subscriptions on credit cards ---
  for (let cursor = startDate; daysBetween(cursor, asOf) >= 0; cursor = addDays(cursor, 1)) {
    const day = Number(cursor.slice(8, 10));
    for (const sub of SUBSCRIPTIONS) {
      if (day === sub.dayOfMonth) {
        transactions.push(makeTx(nextId("sub"), sub.accountId, cursor, sub.amount, "DEBIT", "POSTED", sub.description));
      }
    }
  }

  // --- Variable spend: groceries, fuel, dining, shopping, ambiguous ---
  for (let cursor = startDate; daysBetween(cursor, asOf) >= 0; cursor = addDays(cursor, 1)) {
    if (chance(rng, 0.35)) {
      transactions.push(
        makeTx(nextId("grc"), MOCK_ACCOUNT_IDS.virginCreditCard, cursor, round2(between(rng, 45, 165)), "DEBIT", "POSTED", pick(rng, GROCERY_MERCHANTS)),
      );
    }
    if (chance(rng, 0.22)) {
      transactions.push(
        makeTx(nextId("fuel"), MOCK_ACCOUNT_IDS.amexCreditCard, cursor, round2(between(rng, 55, 110)), "DEBIT", "POSTED", pick(rng, FUEL_MERCHANTS)),
      );
    }
    if (chance(rng, 0.3)) {
      const account = chance(rng, 0.5) ? MOCK_ACCOUNT_IDS.virginCreditCard : MOCK_ACCOUNT_IDS.amexCreditCard;
      transactions.push(
        makeTx(nextId("din"), account, cursor, round2(between(rng, 18, 75)), "DEBIT", "POSTED", pick(rng, DINING_MERCHANTS)),
      );
    }
    if (chance(rng, 0.12)) {
      transactions.push(
        makeTx(nextId("shp"), MOCK_ACCOUNT_IDS.virginCreditCard, cursor, round2(between(rng, 25, 220)), "DEBIT", "POSTED", pick(rng, SHOPPING_MERCHANTS)),
      );
    }
    if (chance(rng, 0.1)) {
      const account = chance(rng, 0.5) ? MOCK_ACCOUNT_IDS.virginCreditCard : MOCK_ACCOUNT_IDS.amexCreditCard;
      transactions.push(
        makeTx(nextId("amb"), account, cursor, round2(between(rng, 15, 90)), "DEBIT", "POSTED", pick(rng, AMBIGUOUS_MERCHANTS)),
      );
    }
  }

  // --- Refunds: occasionally reverse a prior shopping/dining purchase on the same card ---
  const refundCandidates = transactions.filter((t) => t.description.match(/KMART|TARGET|AMAZON|JB HI-FI/i));
  for (const purchase of refundCandidates) {
    if (chance(rng, 0.2)) {
      const refundDate = addDays(purchase.transactionDate, Math.floor(between(rng, 3, 14)));
      if (daysBetween(refundDate, asOf) >= 0) {
        const partial = chance(rng, 0.3);
        const refundAmount = partial ? round2(purchase.amount.toNumber() * between(rng, 0.3, 0.7)) : purchase.amount.toNumber();
        transactions.push(
          makeTx(nextId("rfd"), purchase.accountProviderId, refundDate, refundAmount, "CREDIT", "POSTED", `REFUND ${purchase.description}`),
        );
      }
    }
  }

  // --- Credit-card repayments: CBA pays off each card's prior-month spend on the 20th ---
  for (let cursor = startDate; daysBetween(cursor, asOf) >= 0; cursor = addDays(cursor, 1)) {
    const day = Number(cursor.slice(8, 10));
    if (day !== 20) continue;
    for (const cardAccountId of [MOCK_ACCOUNT_IDS.virginCreditCard, MOCK_ACCOUNT_IDS.amexCreditCard]) {
      const periodStart = addDays(cursor, -30);
      const cardSpend = transactions
        .filter(
          (t) =>
            t.accountProviderId === cardAccountId &&
            t.direction === "DEBIT" &&
            daysBetween(periodStart, t.transactionDate) >= 0 &&
            daysBetween(t.transactionDate, cursor) >= 0,
        )
        .reduce((sum, t) => sum + t.amount.toNumber(), 0);
      const cardRefunds = transactions
        .filter(
          (t) =>
            t.accountProviderId === cardAccountId &&
            t.direction === "CREDIT" &&
            daysBetween(periodStart, t.transactionDate) >= 0 &&
            daysBetween(t.transactionDate, cursor) >= 0,
        )
        .reduce((sum, t) => sum + t.amount.toNumber(), 0);
      const repaymentAmount = round2(Math.max(cardSpend - cardRefunds, 0));
      if (repaymentAmount <= 0) continue;
      transactions.push(
        makeTx(nextId("pmt-out"), MOCK_ACCOUNT_IDS.cbaTransaction, cursor, repaymentAmount, "DEBIT", "POSTED", `PAYMENT TO ${cardAccountId === MOCK_ACCOUNT_IDS.virginCreditCard ? "VIRGIN MONEY CREDIT CARD" : "AMERICAN EXPRESS"}`),
      );
      transactions.push(
        makeTx(nextId("pmt-in"), cardAccountId, cursor, repaymentAmount, "CREDIT", "POSTED", "PAYMENT RECEIVED - THANK YOU"),
      );
    }
  }

  // --- Pending: the most recent few days of card spend haven't posted yet ---
  for (const tx of transactions) {
    const isCard = tx.accountProviderId !== MOCK_ACCOUNT_IDS.cbaTransaction;
    if (isCard && tx.direction === "DEBIT" && daysBetween(tx.transactionDate, asOf) <= 2) {
      tx.status = "PENDING";
      tx.postingDate = null;
    }
  }

  transactions.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const accounts: ProviderAccount[] = [
    {
      providerAccountId: MOCK_ACCOUNT_IDS.cbaTransaction,
      displayName: "Everyday Account",
      accountType: "TRANSACTION",
      currency: "AUD",
      currentBalance: toMoney(balanceOf(transactions, MOCK_ACCOUNT_IDS.cbaTransaction, 4200)),
      availableBalance: toMoney(balanceOf(transactions, MOCK_ACCOUNT_IDS.cbaTransaction, 4200)),
    },
    {
      providerAccountId: MOCK_ACCOUNT_IDS.virginCreditCard,
      displayName: "Velocity High Flyer",
      accountType: "CREDIT_CARD",
      currency: "AUD",
      currentBalance: toMoney(-balanceOf(transactions, MOCK_ACCOUNT_IDS.virginCreditCard, 0)),
      availableBalance: toMoney(6000 + balanceOf(transactions, MOCK_ACCOUNT_IDS.virginCreditCard, 0)),
    },
    {
      providerAccountId: MOCK_ACCOUNT_IDS.amexCreditCard,
      displayName: "Velocity Escape",
      accountType: "CREDIT_CARD",
      currency: "AUD",
      currentBalance: toMoney(-balanceOf(transactions, MOCK_ACCOUNT_IDS.amexCreditCard, 0)),
      availableBalance: toMoney(5000 + balanceOf(transactions, MOCK_ACCOUNT_IDS.amexCreditCard, 0)),
    },
  ];

  return { accounts, transactions };
}

function makeTx(
  id: string,
  accountProviderId: string,
  date: string,
  amount: number,
  direction: "DEBIT" | "CREDIT",
  status: "POSTED" | "PENDING",
  description: string,
): ProviderTransaction {
  return {
    providerTransactionId: id,
    accountProviderId,
    transactionDate: date,
    postingDate: status === "POSTED" ? date : null,
    amount: toMoney(amount),
    direction,
    status,
    description,
    raw: { source: "mock", id, description },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function balanceOf(transactions: ProviderTransaction[], accountId: string, openingBalance: number): number {
  return transactions
    .filter((t) => t.accountProviderId === accountId)
    .reduce((bal, t) => (t.direction === "CREDIT" ? bal + t.amount.toNumber() : bal - t.amount.toNumber()), openingBalance);
}
