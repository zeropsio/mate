import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { parseBrief, renderCrewHome, type CrewDefinition } from "@t3tools/shared/crewHome";
import { crewFromProposal } from "@t3tools/shared/crewTemplates";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { UseCrewCommand } from "~/zerops/crew/useCrewCommand";

import { CrewSetup } from "./CrewSetup";
import type { CrewProposeWith } from "./CrewSetup.logic";

// The signed-in account's storage, in memory: what a closed tab left behind.
const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("~/zerops/accountLifetime", async (original) => ({
  ...(await original<typeof import("~/zerops/accountLifetime")>()),
  accountLocalStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
      return true;
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  },
}));

const ENVIRONMENT = EnvironmentId.make("environment-nova");
const NOVA = { name: "Nova", tint: "amber" as const };
const READY: CrewProposeWith = {
  kind: "ready",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet-4-5" },
};

const homeOf = (definition: CrewDefinition | null): UseCrewCommand => ({
  files:
    definition === null
      ? { state: "unread", waitingFor: "mate-session" }
      : {
          state: "known",
          value: { files: renderCrewHome(definition) },
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "settled" },
        },
  send: async () => ({ _tag: "done" }),
  readFiles: async () => null,
  writeFiles: async () => true,
  pending: false,
  isPending: () => false,
  error: null,
  errorAt: () => null,
  lastFailure: () => null,
  clearError: () => undefined,
});

const TEA_SHOP = {
  lead: { name: "Lead", part: "Plans the tea shop and splits the work." },
  builders: [
    { name: "Checkout", part: "Builds the checkout and its payment step." },
    { name: "Catalog", part: "Builds the tea catalog and its search." },
  ],
};
const proposed = crewFromProposal({
  proposal: TEA_SHOP,
  crew: "crew",
  devHosts: ["appdev"],
});
const nobody: CrewDefinition = { ...proposed, members: [] };
const withGoal = (definition: CrewDefinition, goal: string): CrewDefinition => ({
  ...definition,
  brief: parseBrief("Tea Shop", `${goal}\n`),
});

const render = (
  definition: CrewDefinition | null,
  proposeWith: CrewProposeWith = READY,
  database: boolean | null = false,
): string =>
  renderToStaticMarkup(
    <CrewSetup
      applied={false}
      commands={homeOf(definition)}
      crewmates={[]}
      devHosts={[{ host: "appdev", database }]}
      environmentId={ENVIRONMENT}
      hosts={[]}
      mate={NOVA}
      onAskPorts={() => undefined}
      onClose={() => undefined}
      onEditCrewmate={() => undefined}
      proposeWith={proposeWith}
    />,
  );

const text = (html: string) =>
  html
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/gu, " ");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("CrewSetup", () => {
  beforeEach(() => stored.clear());

  it("brings back the goal written before the page closed", () => {
    stored.set(
      `t3code:crew-setup-draft:v1:${ENVIRONMENT}`,
      JSON.stringify({ goal: "A tea shop that ships weekly." }),
    );
    expect(render(nobody)).toContain(">A tea shop that ships weekly.</textarea>");
  });

  it("waits for the goal to suggest a crew, and says so under the suggestion", () => {
    const html = render(nobody);
    expect(html).toMatch(/<button[^>]*data-crew-suggest[^>]*disabled/u);
    expect(text(html)).toContain("Let Nova suggest a crew Write the goal first.");
  });

  it("offers the suggestion once there is a goal", () => {
    const html = render(withGoal(nobody, "A tea shop that ships weekly."));
    expect(html).not.toMatch(/<button[^>]*data-crew-suggest[^>]*disabled/u);
    expect(text(html)).toContain("Nova reads the goal and proposes who does what.");
  });

  it("says why the suggestion can't be asked by this viewer", () => {
    const html = render(withGoal(nobody, "A tea shop."), {
      kind: "unavailable",
      words: "Nova's agent was signed in by another project member.",
    });
    expect(text(html)).toContain(
      "Let Nova suggest a crew Nova's agent was signed in by another project member.",
    );
  });

  it("starts the crew only with a goal, and says so beside the press", () => {
    const html = render(withGoal(proposed, ""));
    expect(text(html)).toContain("Start the crew Write the goal first.");
    expect(text(render(withGoal(proposed, "A tea shop.")))).not.toContain("Write the goal first.");
  });

  it("lists each crewmate by its name and its part, with no tag repeating it", () => {
    const words = text(render(withGoal(proposed, "A tea shop.")));
    expect(words).toContain("Checkout Builds the checkout and its payment step.");
    expect(words).not.toMatch(/\b(Plans|Builds|Reviews) (Plans|Builds)/u);
  });

  it("says which crewmate leads beside its name", () => {
    const planner = crewFromProposal({
      proposal: { ...TEA_SHOP, lead: { name: "Planner", part: TEA_SHOP.lead.part } },
      crew: "crew",
      devHosts: ["appdev"],
    });
    const words = text(render(withGoal(planner, "A tea shop.")));
    expect(words).toContain("Planner · Lead Plans the tea shop and splits the work.");
    expect(words).toContain("Checkout Builds the checkout and its payment step.");
  });

  // The onboarding run, 2026-10-16: when the Mate's roster landed, the goal's line went, its box
  // jumped up 20 px and shrank from 164 to 120 px, and a three-line note pushed Start down.
  it("keeps the goal and the footer's note as they were when a proposal lands", () => {
    const goalBlock = (html: string) =>
      /The goal<\/span>[\s\S]*?<\/textarea>/u.exec(html)?.[0] ?? "no goal block";
    const before = render(withGoal(nobody, "A tea shop."));
    const after = render(withGoal(proposed, "A tea shop."));
    expect(goalBlock(before)).toContain("Every crewmate reads it.");
    expect(goalBlock(after)).toBe(goalBlock(before));
    expect(text(before)).toContain("Each builder works in its own copy of Nova's code");
  });

  it("says once, in the footer, that each crewmate works in its own copy", () => {
    const words = text(render(withGoal(proposed, "A tea shop.")));
    expect(count(words, "own copy")).toBe(1);
    expect(words).toContain(
      "Each builder works in its own copy of Nova's code; nothing reaches Nova's code until you review it.",
    );
  });

  it("says the builders share their service's database only when a builder's service reaches one", () => {
    const sharing = crewFromProposal({
      proposal: TEA_SHOP,
      crew: "crew",
      devHosts: ["appdev"],
      databaseHosts: ["appdev"],
    });
    expect(text(render(withGoal(sharing, "A tea shop."), READY, true))).toContain(
      "until you review it. The builders share one database.",
    );
    expect(text(render(withGoal(proposed, "A tea shop."), READY, false))).not.toContain("database");
    // Not known yet: never said, and never "no".
    expect(text(render(withGoal(sharing, "A tea shop."), READY, null))).not.toContain("database");
  });
});
