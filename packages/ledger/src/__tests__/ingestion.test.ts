import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { toIngestibleTransactionFields, type NormalizedTransactionInput } from "../ingestion.js";

describe("toIngestibleTransactionFields (Task 6B privacy allow-list)", () => {
  it("maps every allowed field through unchanged", () => {
    const input: NormalizedTransactionInput = {
      sourceAccountId: "provider-account-xyz",
      sourceTransactionId: "tx_123",
      transactionDate: "2026-08-10",
      postingDate: "2026-08-11",
      amount: 42.5,
      direction: "DEBIT",
      status: "POSTED",
      description: "COLES 0092 BRISBANE AU",
      sourceType: "PROVIDER_SYNC",
    };

    const result = toIngestibleTransactionFields(input);

    expect(result.providerTransactionId).toBe("tx_123");
    expect(result.transactionDate).toBe("2026-08-10");
    expect(result.postingDate).toBe("2026-08-11");
    expect(result.amount.equals(toMoney(42.5))).toBe(true);
    expect(result.direction).toBe("DEBIT");
    expect(result.status).toBe("POSTED");
    expect(result.originalDescription).toBe("COLES 0092 BRISBANE AU");
    expect(result.sourceType).toBe("PROVIDER_SYNC");
  });

  it("passes through a null sourceTransactionId and null postingDate (pending transactions, some sources)", () => {
    const input: NormalizedTransactionInput = {
      sourceAccountId: "provider-account-xyz",
      sourceTransactionId: null,
      transactionDate: "2026-08-10",
      postingDate: null,
      amount: 10,
      direction: "DEBIT",
      status: "PENDING",
      description: "PENDING CARD AUTH",
      sourceType: "PROVIDER_SYNC",
    };

    const result = toIngestibleTransactionFields(input);
    expect(result.providerTransactionId).toBeNull();
    expect(result.postingDate).toBeNull();
  });

  it("never lets banking-identity or raw-payload fields cross the allow-list, even when present on the source object", () => {
    // Simulates a real provider/CDR response shape that carries far more
    // than FrodoCodo ever asked for (docs/banking-data-minimisation-audit.md
    // §3): a full/masked account number, a BSB, a customer name, and a
    // whole raw payload blob alongside the fields this module actually
    // needs. A caller must map through NormalizedTransactionInput first
    // (which structurally has no slot for any of this) -- this test proves
    // that even if a caller carelessly widens the type or spreads extra
    // properties onto the object it hands in, toIngestibleTransactionFields
    // only ever reads/returns the documented allow-listed fields.
    const dangerousInput = {
      sourceAccountId: "provider-account-xyz",
      sourceTransactionId: "tx_999",
      transactionDate: "2026-08-10",
      postingDate: "2026-08-10",
      amount: 99.99,
      direction: "DEBIT",
      status: "POSTED",
      description: "SOME MERCHANT",
      sourceType: "PROVIDER_SYNC",
      // Everything below must never appear in the output.
      accountNumber: "12345678",
      maskedAccountNumber: "****5678",
      bsb: "062-000",
      customerName: "Alex Household",
      customerAddress: "1 Example St, Brisbane QLD",
      cardNumber: "4111111111111111",
      rawPayload: { anything: "the provider felt like sending" },
      raw: { anything: "the provider felt like sending" },
    } as unknown as NormalizedTransactionInput;

    const result = toIngestibleTransactionFields(dangerousInput);
    const keys = Object.keys(result);

    expect(keys.sort()).toEqual(
      ["providerTransactionId", "transactionDate", "postingDate", "amount", "direction", "status", "originalDescription", "sourceType"].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/accountNumber|maskedAccountNumber|bsb|customerName|customerAddress|cardNumber|rawPayload|4111111111111111|062-000|12345678/i);
  });
});
