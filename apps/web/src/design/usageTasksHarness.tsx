/**
 * Usage's automated Mate task rows under a Mate's row, from fixtures: a period older than the
 * tasks HQ lists (its 20 newest ended ones), with rows and with none, and a short period with none.
 *
 * Served by the dev server at `/design-usage-tasks.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000.
 *
 * Fixtures only. Nothing here ships — `design-usage-tasks.html` is not `index.html`, and no route
 * imports this module.
 */
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { UsageMateTaskRowsView } from "~/components/usage/UsageAutomated";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const nothing = () => {};

const task = (at: number, mate: "tea-raya" | "tea-nova"): HqAppTask => {
  const ended = Date.parse("2026-10-17T12:00:00.000Z") - at * 6 * 3_600_000;
  return {
    id: `task-${String(at)}`,
    title: ["Add a search box to the tea list", "Show each tea's price", "Fix the checkout total"][
      at % 3
    ]!,
    label: `acme/tea-shop#${String(40 - at)}`,
    url: `https://github.com/acme/tea-shop/issues/${String(40 - at)}`,
    state: at % 4 === 0 ? "done" : "merged",
    mate:
      mate === "tea-raya"
        ? { projectId: "tea-raya", name: "Raya" }
        : { projectId: "tea-nova", name: "Nova" },
    requestedBy: "juno",
    createdAt: new Date(ended - 30 * 60_000).toISOString(),
    startedAt: new Date(ended - 25 * 60_000).toISOString(),
    endedAt: new Date(ended).toISOString(),
    spentUsd: 0.4 + at * 0.05,
    workedMs: (12 + at) * 60_000,
    detail: null,
    change: null,
    pullRequest: null,
    link: null,
  };
};
// HQ's list: the application's 20 newest ended tasks, Raya's three among them.
const LISTED = Array.from({ length: 20 }, (_, at) =>
  task(at, at === 1 || at === 4 || at === 9 ? "tea-raya" : "tea-nova"),
);
const known = { state: "known" as const, held: LISTED, stale: false };
const UNTIL = "2026-10-18T00:00:00.000Z";

function MateRow({ name, cost }: { readonly name: string; readonly cost: string }) {
  return (
    <tr className="border-b border-border/50 text-sm">
      <td className="py-2 ps-6">{name}</td>
      <td className="py-2 text-right tabular-nums">{cost}</td>
      <td className="w-8" />
    </tr>
  );
}

function Case({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <table className="w-full border-collapse">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Harness() {
  return (
    <div className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <Case title="This month: older than the 20 listed, Raya's three among them">
          <MateRow cost="$14.20" name="Raya" />
          <UsageMateTaskRowsView
            again={nothing}
            mateProjectId="tea-raya"
            nested={false}
            setting={known}
            since="2026-10-01T00:00:00.000Z"
            until={UNTIL}
          />
        </Case>
        <Case title="Last 90 days: none of Juno's tasks among the 20 listed">
          <MateRow cost="$9.80" name="Juno" />
          <UsageMateTaskRowsView
            again={nothing}
            mateProjectId="tea-juno"
            nested={false}
            setting={known}
            since="2026-07-20T00:00:00.000Z"
            until={UNTIL}
          />
        </Case>
        <Case title="Today: the period inside the list, nothing of Juno's">
          <MateRow cost="$0" name="Juno" />
          <UsageMateTaskRowsView
            again={nothing}
            mateProjectId="tea-juno"
            nested={false}
            setting={known}
            since="2026-10-17T06:00:00.000Z"
            until={UNTIL}
          />
        </Case>
      </div>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
