// @vitest-environment happy-dom
import { EnvironmentId, type UsageLimitsReport } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NoticeLine } from "./ConversationRows";
import { usageLimitsNotice } from "./UsageLimitsNotice";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const account = (label: string, plan: string) =>
  ({
    id: label,
    driver: "claudeAgent",
    label,
    plan,
    limits: { windows: [] },
  }) as unknown as UsageLimitsReport["accounts"][number];

describe("the /usage-limits answer", () => {
  it.each([
    { accounts: [account("Claude", "Max")], line: "Usage limits · Claude · Max" },
    {
      accounts: [account("Claude", "Max"), account("Claude work", "Team")],
      line: "Usage limits · 2 accounts",
    },
  ])(
    "says each account's limits whole under its line, and × puts it away: $line",
    async ({ accounts, line }) => {
      const dismiss = vi.fn();
      const report: UsageLimitsReport = {
        createdAt: "2026-10-12T10:00:00.000Z",
        accounts,
        notices: ["The hub was last read at 9:58."],
      };
      await act(() =>
        root!.render(
          <NoticeLine
            notice={usageLimitsNotice("usage-limits:1", report, EnvironmentId.make("env"), dismiss)}
          />,
        ),
      );
      const text = document.body.textContent!;
      expect(text.startsWith(line)).toBe(true);
      expect(text).toContain("No limits reported.");
      expect(text).toContain("The hub was last read at 9:58.");
      await act(() =>
        document.querySelector<HTMLButtonElement>('[aria-label="Dismiss usage limits"]')!.click(),
      );
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );
});
