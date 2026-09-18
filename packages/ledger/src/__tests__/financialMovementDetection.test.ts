import { describe, expect, it } from "vitest";
import { classifyFinancialMovement } from "../financialMovementDetection.js";

describe("classifyFinancialMovement", () => {
  it("confidently recognises a salary credit as non-spend", () => {
    expect(classifyFinancialMovement({ originalDescription: "SALARY - ACME PTY LTD", direction: "CREDIT" })).toBe(
      "CONFIDENT_NON_SPEND",
    );
    expect(classifyFinancialMovement({ originalDescription: "PAYROLL DEPOSIT", direction: "CREDIT" })).toBe("CONFIDENT_NON_SPEND");
  });

  it("does not treat a salary-shaped description as confident non-spend on a DEBIT (direction still matters)", () => {
    expect(classifyFinancialMovement({ originalDescription: "SALARY ADVANCE REPAYMENT", direction: "DEBIT" })).toBe("ORDINARY");
  });

  it("flags generic transfer language as uncertain, not confident", () => {
    expect(classifyFinancialMovement({ originalDescription: "TRANSFER TO SAVINGS", direction: "DEBIT" })).toBe(
      "UNCERTAIN_NON_SPEND",
    );
    expect(classifyFinancialMovement({ originalDescription: "TRANSFER FROM CBA SAVER", direction: "CREDIT" })).toBe(
      "UNCERTAIN_NON_SPEND",
    );
    expect(classifyFinancialMovement({ originalDescription: "XFER TO INVESTMENT ACCOUNT", direction: "DEBIT" })).toBe(
      "UNCERTAIN_NON_SPEND",
    );
  });

  it("treats ordinary merchant spend as ORDINARY", () => {
    expect(classifyFinancialMovement({ originalDescription: "WOOLWORTHS 2178 SYDNEY AU", direction: "DEBIT" })).toBe("ORDINARY");
    expect(classifyFinancialMovement({ originalDescription: "NETFLIX.COM", direction: "DEBIT" })).toBe("ORDINARY");
  });

  it("does not flag a loan repayment, BPAY bill, or direct debit as non-spend (conservative: these are legitimate budget-trackable spend)", () => {
    expect(classifyFinancialMovement({ originalDescription: "LOAN REPAYMENT - HOME LOAN", direction: "DEBIT" })).toBe("ORDINARY");
    expect(classifyFinancialMovement({ originalDescription: "BPAY PAYMENT TELSTRA", direction: "DEBIT" })).toBe("ORDINARY");
    expect(classifyFinancialMovement({ originalDescription: "DIRECT DEBIT ORIGIN ENERGY", direction: "DEBIT" })).toBe("ORDINARY");
  });
});
