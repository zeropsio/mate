import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "vite-plus/test";

import {
  crewmateDraftOf,
  crewmateSpecOf,
  emptyCrewmateDraft,
  withBrief,
  withMember,
} from "./crewHome";

const member = (
  fields: Partial<CrewMemberSpec> & Pick<CrewMemberSpec, "handle">,
): CrewMemberSpec => ({
  displayName: fields.handle,
  kind: "writer",
  readOnly: false,
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: "Builds things.\n",
  ...fields,
});

const backend = member({
  handle: "backend",
  displayName: "Backend",
  tint: "sky",
  host: "appdev",
  setup: "npm ci",
  check: "npm test",
  run: "npm run dev -- --port $CREW_PORT",
  restartAfterMerge: true,
  login: "claudeAgent",
  model: "claude-opus-5-5",
  effort: "high",
  env: { DATABASE_URL: "postgres://crew" },
  migrations: ["db/migrations/**"],
  context: 300_000,
  rotateAfter: 2,
});

const definition: CrewDefinition = {
  crew: "crew",
  name: "Game team",
  brief: parseBrief("Space shooter", "Build it.\n"),
  members: [backend, member({ handle: "erik", tint: "amber" })],
};

describe("the crewmate draft", () => {
  it("round-trips a crewmate through the editor unchanged", () => {
    expect(crewmateSpecOf(crewmateDraftOf(backend), false, backend)).toEqual(backend);
  });

  it("drops a read-only crewmate's copy: no service, commands, switches or env", () => {
    const draft = { ...crewmateDraftOf(backend), readOnly: true };
    expect(crewmateSpecOf(draft, false, backend)).toEqual({
      handle: "backend",
      displayName: "Backend",
      kind: "reader",
      readOnly: true,
      tint: "sky",
      restartAfterMerge: false,
      afterLandRestart: false,
      login: "claudeAgent",
      model: "claude-opus-5-5",
      effort: "high",
      env: {},
      migrations: [],
      context: 300_000,
      rotateAfter: 2,
      job: "Builds things.\n",
    });
  });

  it("keeps the lead a read-only lead", () => {
    const spec = crewmateSpecOf({ ...emptyCrewmateDraft(true), job: "Plans." }, true, undefined);
    expect([spec.handle, spec.kind, spec.readOnly]).toEqual(["lead", "lead", true]);
  });

  it("leaves blank commands and the login's defaults out", () => {
    const spec = crewmateSpecOf(
      {
        ...emptyCrewmateDraft(false),
        handle: "qa",
        displayName: " QA ",
        host: "appdev",
        setup: "  ",
      },
      false,
      undefined,
    );
    expect(spec).toEqual({
      handle: "qa",
      displayName: "QA",
      kind: "writer",
      readOnly: false,
      host: "appdev",
      restartAfterMerge: false,
      afterLandRestart: false,
      login: "claudeAgent",
      env: {},
      migrations: [],
      job: "",
    });
  });
});

describe("withMember and withBrief", () => {
  it("replaces a crewmate by handle, keeping the others in order", () => {
    const next = withMember(
      definition,
      "backend",
      member({ handle: "backend", displayName: "API" }),
    );
    expect(next.members.map((mate) => [mate.handle, mate.displayName])).toEqual([
      ["backend", "API"],
      ["erik", "erik"],
    ]);
  });

  it("adds a crewmate at the end", () => {
    const next = withMember(definition, null, member({ handle: "qa" }));
    expect(next.members.map((mate) => mate.handle)).toEqual(["backend", "erik", "qa"]);
  });

  it("sets the brief's title and text, reading its sections again", () => {
    const next = withBrief(definition, "Shop", "Sell things.\n\n## Done when\n- a guest pays\n");
    expect(next.brief).toEqual({
      title: "Shop",
      text: "Sell things.\n\n## Done when\n- a guest pays\n",
      doneWhen: ["a guest pays"],
    });
  });
});
