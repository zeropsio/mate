import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CrewRun } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "~/components/ui/dialog";

import { CrewResumeBody, CrewStartBody } from "./CrewRunDialog";
import { crewRunDraft } from "./CrewRunDialog.logic";

/** The visible text, tags and style sheets stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gsu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

const RUN = crewSnapshotFixture().run!;

function renderStart(
  hasLead: boolean,
  lastRun: CrewRun | null = RUN,
  spendBlocker: string | null = null,
) {
  return renderToStaticMarkup(
    <Dialog defaultOpen>
      <CrewStartBody
        canAct
        error={null}
        hasLead={hasLead}
        spendBlocker={spendBlocker}
        initial={crewRunDraft(lastRun, hasLead)}
        mateName="Fen"
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    </Dialog>,
  );
}

function renderResume(run: CrewRun) {
  return renderToStaticMarkup(
    <Dialog defaultOpen>
      <CrewResumeBody
        canAct
        error={null}
        spendBlocker={null}
        onCancel={() => undefined}
        onResume={() => undefined}
        run={run}
      />
    </Dialog>,
  );
}

/** A press drawn disabled, by its words. */
const disabledPress = (words: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>(?:<[^>]*>)*${words}<`, "u");

describe("CrewStartBody — Let the crew work on its own", () => {
  it("says its two limits, the plan's stop, what happens to done work and what it may do", () => {
    expect(textOf(renderStart(true))).toBe(
      [
        "Let the crew work on its own",
        "It keeps going without asking you at each step, and stops by itself at whichever limit it reaches first.",
        "Stop when it has spent $ No limit",
        "Stop after hours No limit",
        "Stop before it uses more than 80 % of your Claude plan's limit",
        "When a piece of work is done",
        "Wait for my review It waits in the Crew tab: Review it, try it, add it to Fen's code.",
        "Add it to Fen's code once the lead approves it The lead checks each piece and sends back what isn't right.",
        "The lead may start its own tasks without asking",
        "Crewmates may show their work at Fen's dev address without asking",
        "Cancel Start",
      ].join(" "),
    );
  });

  it("says beside the budget why a crew whose agent hides its spend can't keep one", () => {
    const blocker = "Grok doesn't report what it spends, so this crew can't keep a budget.";
    const text = textOf(renderStart(true, RUN, blocker));
    expect(text).toContain(`Stop when it has spent $ No limit ${blocker}`);
  });

  it("offers adding work once its checks pass, and no lead's leave, without a lead", () => {
    const text = textOf(renderStart(false));
    expect(text).toContain("Add it to Fen's code once its checks pass");
    expect(text).not.toContain("the lead approves it");
    expect(text).not.toContain("The lead may start its own tasks without asking");
  });

  it("holds Start on the first run until a budget is picked, and starts from the last run after", () => {
    expect(renderStart(true, null)).toMatch(disabledPress("Start"));
    const later = renderStart(true);
    expect(later).not.toMatch(disabledPress("Start"));
    expect(later).toContain('value="20"');
    expect(later).toContain('value="8"');
  });

  it("names no engine noun: no run, no budget, no landing, no versions", () => {
    const text = textOf(renderStart(true));
    expect(text).not.toMatch(/\b(?:run|budget|land|lands|landing|deliver|brief)\b/iu);
    expect(text).not.toMatch(/\bv\d+\b|#\d+|@[a-z]/u);
  });
});

describe("CrewResumeBody — Keep going", () => {
  it("sets apart the money that stopped it and asks for more, never a new figure", () => {
    const paused = { ...RUN, state: "paused" as const, reason: "budget" as const, spentUsd: 20 };
    const html = renderResume(paused);
    const text = textOf(html);
    expect(text.startsWith("Keep going")).toBe(true);
    expect(text).toContain("$ more No limit");
    expect(html).toContain('value="20"');
    expect(text.endsWith("Cancel Keep going")).toBe(true);
    expect(html).not.toMatch(disabledPress("Keep going"));
  });

  it("asks for more time after its hours ran out", () => {
    const paused = { ...RUN, state: "paused" as const, reason: "time" as const };
    const text = textOf(renderResume(paused));
    expect(text).toContain("hours more No limit");
    expect(text).not.toContain("$");
  });

  it("raises the plan's stop, or turns it off, after it neared the plan's limit", () => {
    const paused = {
      ...RUN,
      state: "paused" as const,
      reason: "usage" as const,
      usagePercent: 81,
    };
    const html = renderResume(paused);
    expect(html).toContain('value="90"');
    expect(html).not.toMatch(disabledPress("Keep going"));
  });

  it("goes on as it was after you stopped it", () => {
    const paused = { ...RUN, state: "paused" as const, reason: "person" as const };
    const html = renderResume(paused);
    expect(html).not.toContain("<input");
    expect(html).not.toMatch(disabledPress("Keep going"));
  });
});
