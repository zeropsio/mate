import { describe, expect, it } from "vite-plus/test";

import { readOrganizationCost } from "../families/organizationCost.ts";
import { billingTone, stopWords } from "./billing.ts";

const calm = { total: 500, daysLeft: 60, refills: false, soonestHours: null };

describe("an organization's money, as the menu and its projects say it", () => {
  // witness: packages/client-runtime/src/data/projections/billing.ts | if (input.total !== null && input.total < 0) return "out"; → if (input.total !== null && input.total < -1) return "out";
  it("a balance below zero is out of credit", () => {
    expect(billingTone({ ...calm, total: -0.5 })).toBe("out");
    expect(billingTone(calm)).toBe("quiet");
  });

  // witness: packages/client-runtime/src/data/projections/billing.ts | if (input.soonestHours !== null && input.soonestHours <= STOP_IMMINENT_HOURS) return "out"; → if (input.soonestHours !== null && input.soonestHours <= 1) return "out";
  it("a project Zerops stops within its own eight hours is out, within three days low", () => {
    expect(billingTone({ ...calm, soonestHours: 6 })).toBe("out");
    expect(billingTone({ ...calm, soonestHours: 40 })).toBe("low");
    expect(billingTone({ ...calm, soonestHours: 200 })).toBe("quiet");
  });

  // witness: packages/client-runtime/src/data/projections/billing.ts | if (!input.refills && input.daysLeft !== null && input.daysLeft < LOW_DAYS) return "low"; → if (input.daysLeft !== null && input.daysLeft < LOW_DAYS) return "low";
  it("a balance lasting under three days runs low, unless an automatic top-up refills it", () => {
    expect(billingTone({ ...calm, daysLeft: 2 })).toBe("low");
    expect(billingTone({ ...calm, daysLeft: 2, refills: true })).toBe("quiet");
  });

  // witness: packages/client-runtime/src/data/projections/billing.ts | if (hoursLeft <= 2) return "in under 2 hours"; → if (hoursLeft <= 1) return "in under 2 hours";
  it("says when a project stops in the Zerops GUI's own thresholds, then in hours and days", () => {
    expect(stopWords(1.5)).toBe("in under 2 hours");
    expect(stopWords(7)).toBe("in under 8 hours");
    expect(stopWords(13.2)).toBe("in about 14 hours");
    expect(stopWords(30)).toBe("in about a day");
    expect(stopWords(60)).toBe("in about 3 days");
  });
});

describe("an organization's cost, as billing answers it", () => {
  // witness: packages/client-runtime/src/data/families/organizationCost.ts | perDay: (period?.averageLast30Days ?? 0) / 30, → perDay: period?.averageLast30Days ?? 0,
  it("reads each period, its daily rate a thirtieth of the 30 days' average", () => {
    const period = { today: 3, thisMonth: 90, last30days: 120, averageLast30Days: 150 };
    expect(
      readOrganizationCost({
        client: { id: "org", periodCost: period },
        project: [{ id: "p1", periodCost: { ...period, thisMonth: 40 } }],
        stack: [],
      }),
    ).toEqual({
      organization: { today: 3, thisMonth: 90, last30Days: 120, perDay: 5 },
      projects: { p1: { today: 3, thisMonth: 40, last30Days: 120, perDay: 5 } },
    });
  });

  // witness: packages/client-runtime/src/data/families/organizationCost.ts | ? null → ? { organization: periodOf(undefined), projects: {} }
  it("reads an answer without the organization as unread, never as nothing spent", () => {
    expect(readOrganizationCost({ project: [] })).toBeNull();
  });
});
