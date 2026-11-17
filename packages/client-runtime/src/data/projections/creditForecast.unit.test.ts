import { expect, it } from "vite-plus/test";

import { ORG } from "../__fixtures__/account.ts";
import { organizationBalanceFamily } from "../families/organizationBalance.ts";

const decode = organizationBalanceFamily.zerops!.decode;
const frame = (answer: Record<string, unknown>) => ({
  id: "status-row",
  clientId: ORG,
  _version: 3,
  ...answer,
});

// witness: packages/client-runtime/src/data/families/organizationBalance.ts | const amount = typeof value === "number" ? value : Number(value); → const amount = typeof value === "number" ? value : Number.NaN;
it("PJ7: An organization's automatic top-up is read from the decimal amounts Zerops sends", () => {
  const answer = {
    credit: 10,
    promoCredit: 0,
    autoTopUp: { threshold: "50", amount: "100.5", calendarMonthlyLimit: "300" },
    status: "ACTIVE",
  };
  expect(decode(frame(answer))?.value).toEqual({
    organizationId: ORG,
    credit: 10,
    promoCredit: 0,
    autoTopUp: { threshold: 50, amount: 100.5, monthlyLimit: 300 },
    status: "ACTIVE",
  });
});
