import { describe, expect, it } from "vitest";
import {
  defaultRegistrationFormSetup,
  registrationFormIssue,
  registrationPayloadForSetup,
  showDailyContributionForAccountType
} from "@bms/shared";

const BASE_DRAFT = {
  houseNumber: "H/12",
  dateOfBirth: "1992-04-10",
  occupation: "Trader",
  idCardType: "ghana_card",
  idCardNumber: "GHA-123456789-0",
  idCardPhotoUrl: "https://example.com/id.jpg",
  nextOfKin: {
    fullName: "Ama Mensah",
    phone: "0244123456",
    location: "Accra"
  }
};

describe("registrationForm daily contribution rules (Susu vs Savings)", () => {
  it("always enables and preserves daily savings amount for Susu accounts", () => {
    const setupHidden = {
      ...defaultRegistrationFormSetup(),
      fields: {
        ...defaultRegistrationFormSetup().fields,
        dailyContribution: "hidden" as const
      }
    };

    expect(showDailyContributionForAccountType("susu", "hidden")).toBe(true);
    expect(showDailyContributionForAccountType("susu", "optional")).toBe(true);
    expect(showDailyContributionForAccountType("susu", "required")).toBe(true);

    const normalized = registrationPayloadForSetup(
      { ...BASE_DRAFT, accountType: "susu", dailyContributionAmount: 25 },
      setupHidden
    );
    expect(normalized.dailyContributionAmount).toBe(25);

    const setupRequired = {
      ...defaultRegistrationFormSetup(),
      fields: {
        ...defaultRegistrationFormSetup().fields,
        dailyContribution: "required" as const
      }
    };
    expect(
      registrationFormIssue(
        { ...BASE_DRAFT, accountType: "susu", dailyContributionAmount: 0 },
        setupRequired
      )
    ).toMatch(/daily contribution greater than zero/i);
    expect(
      registrationFormIssue(
        { ...BASE_DRAFT, accountType: "susu", dailyContributionAmount: 20 },
        setupRequired
      )
    ).toBeNull();
  });

  it("disables daily fixed amount on normal Savings accounts even when required globally", () => {
    const setupRequired = {
      ...defaultRegistrationFormSetup(),
      fields: {
        ...defaultRegistrationFormSetup().fields,
        dailyContribution: "required" as const
      }
    };

    expect(showDailyContributionForAccountType("savings", "required")).toBe(false);
    expect(showDailyContributionForAccountType("savings", "optional")).toBe(false);
    expect(showDailyContributionForAccountType("savings", "hidden")).toBe(false);

    // Must NOT block normal Savings registration when dailyContribution is required
    expect(
      registrationFormIssue(
        { ...BASE_DRAFT, accountType: "savings", dailyContributionAmount: 0 },
        setupRequired
      )
    ).toBeNull();

    // Always normalizes Savings dailyContributionAmount to 0
    const normalized = registrationPayloadForSetup(
      { ...BASE_DRAFT, accountType: "savings", dailyContributionAmount: 50 },
      setupRequired
    );
    expect(normalized.dailyContributionAmount).toBe(0);
  });
});
