/**
 * The composer's top — a Mate's changes waiting for the person's review — in the composer's own
 * frame: one change, two, three, and five (the newest three and "and 2 more").
 *
 * Served by the dev server at `/design-composer-top.html` (`?theme=dark`; `?n=2` shows one state
 * alone). Fixtures only: nothing here ships, and no route imports this module.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  ZeropsNextStepStrip,
  type ZeropsNextStepStripModel,
} from "~/components/zerops/ZeropsNextStepBanner";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const ONLY = params.get("n");

const CHANGES = [
  ["apidev", 1, "Rebuild the full API on the new schema, with the old routes kept for a week"],
  ["appdev", 1, "Build the campaign website with the signup form and the countdown"],
  ["appdev", 2, "Add a footer with the press links"],
  ["appdev", 3, "Tune the hero images for phones"],
  ["apidev", 2, "Rate-limit the signup route"],
] as const;

function stripOf(count: number): ZeropsNextStepStripModel {
  const [first] = CHANGES;
  const target = (repository: string, number: number) =>
    ({ kind: "change", groupId: "g-1", repository, number }) as const;
  return {
    title:
      count === 1
        ? `Wren is waiting for your review of #${String(first[1])}`
        : `Wren is waiting for your review of ${String(count)} changes`,
    detail: first[2],
    tint: "sky",
    target: target(first[0], first[1]),
    ...(count === 1
      ? {}
      : {
          lines: CHANGES.slice(0, Math.min(3, count)).map(([repository, number, title]) => ({
            label: `${repository} #${String(number)} ${title}`,
            target: target(repository, number),
          })),
          more: Math.max(0, count - 3),
        }),
  };
}

function Composer({ count }: { readonly count: number }) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2" data-composer-top-harness={count}>
      <span className="text-xs font-medium text-muted-foreground">
        {count === 1 ? "One change" : `${String(count)} changes`}
      </span>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card"
        data-chat-composer-main-surface="true"
      >
        <div data-chat-composer-surface="true">
          <ZeropsNextStepStrip onMore={() => {}} onReview={() => {}} strip={stripOf(count)} />
          <div className="px-4 pt-3 pb-12 text-placeholder text-sm">Ask anything...</div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  const counts = ONLY === null ? [1, 2, 3, 5] : [Number(ONLY)];
  return (
    <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
      {counts.map((count) => (
        <Composer count={count} key={count} />
      ))}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
