import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CrewRun } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "~/components/ui/dialog";

import { CrewRunDialogBody } from "./CrewRunDialog";
import { crewRunDraft } from "./CrewRunDialog.logic";

/** The visible text, tags and style sheets stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gsu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

function renderBody(
  hasLead: boolean,
  lastRun = crewSnapshotFixture().run,
  resume: CrewRun | null = null,
) {
  return renderToStaticMarkup(
    <Dialog open>
      <CrewRunDialogBody
        initial={crewRunDraft(lastRun, hasLead)}
        hasLead={hasLead}
        canAct
        error={null}
        onStart={() => undefined}
        resume={resume}
      />
    </Dialog>,
  );
}

describe("CrewRunDialogBody", () => {
  it("asks for budget, time limit, usage, landing and dev, and the lead's leave to start", () => {
    expect(textOf(renderBody(true))).toBe(
      [
        "Start a run",
        "Budget $ No limit",
        "Time limit h No limit",
        "Usage Stop at 80 % of the usage window",
        "Landing I land everything The lead lands after its review",
        "Dev Ask me before showing a crewmate's work on dev The crew may show work on dev",
        "The lead The lead may start tasks without asking",
        "Cancel Start",
      ].join(" "),
    );
  });

  it("offers landing on a passed check, and no lead's leave, without a lead", () => {
    const text = textOf(renderBody(false));
    expect(text).toContain("Landing I land everything Land when the check passes");
    expect(text).not.toContain("The lead may start tasks without asking");
  });

  it("holds Start on the first run until a budget is picked", () => {
    /** The Budget group's markup, where a picked radio's input carries `checked`. */
    const budgetOf = (html: string) =>
      html.slice(html.indexOf('aria-label="Budget"'), html.indexOf('aria-label="Time limit"'));
    const first = renderBody(true, null);
    expect(budgetOf(first)).not.toContain(' checked=""');
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>Start<\/button>/u);
    const later = renderBody(true);
    expect(budgetOf(later)).toContain(' checked="" value="amount"');
    expect(later).not.toMatch(/<button[^>]*disabled=""[^>]*>Start<\/button>/u);
  });

  it("resumes a budget-stopped run: its budget set apart, the other options as they stand", () => {
    const run = crewSnapshotFixture().run!;
    const paused = { ...run, state: "paused" as const, reason: "budget" as const, spentUsd: 20 };
    const html = renderBody(true, paused, paused);
    const text = textOf(html);

    expect(text.startsWith("Resume the run Paused · budget reached")).toBe(true);
    expect(html).toContain('data-crew-run-limit-reached="budget"');
    expect(text).toContain("Raise it above the $20.00 already spent, or pick No limit.");
    expect(text).toContain("Landing I land everything");
    expect(text).toContain("Dev Ask me before showing a crewmate's work on dev");
    expect(text).not.toContain("The lead lands after its review");
    expect(text).not.toContain("The crew may show work on dev");
    expect(text.endsWith("Cancel Resume")).toBe(true);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Resume<\/button>/u);
  });
});
