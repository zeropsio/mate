import { describe, expect, it } from "vite-plus/test";

import {
  creationJobSendable,
  creationHandoffPrompt,
  parseCreationHandoffs,
  readCreationHandoff,
  creationJobToStart,
  withCreationHandoff,
  withCreationHandoffPromoted,
  withoutCreationHandoff,
  type ZeropsCreationHandoff,
} from "./creationHandoff.ts";

const CLONED: ZeropsCreationHandoff = {
  environmentName: "Aurora - stage",
  groupName: "Aurora",
  role: "stage",
  source: { kind: "clone", name: "Aurora - dev", needsDeploy: ["app"] },
};

describe("creationHandoffPrompt", () => {
  it("names what the environment is, where it came from, and the job", () => {
    const prompt = creationHandoffPrompt(CLONED);
    expect(prompt).toContain("Aurora - stage");
    expect(prompt).toContain("stage environment");
    expect(prompt).toContain("Aurora");
    expect(prompt).toContain("cloned from Aurora - dev");
    expect(prompt).toContain("app");
  });

  it("asks for a first deploy only where the clone could not carry the build", () => {
    const prompt = creationHandoffPrompt({
      ...CLONED,
      source: { kind: "clone", name: "Aurora - dev", needsDeploy: [] },
    });
    expect(prompt).not.toContain("deploy");
    expect(prompt).toContain("cloned from Aurora - dev");
  });

  it("lists every service that needs one, not just the first", () => {
    const prompt = creationHandoffPrompt({
      ...CLONED,
      source: { kind: "clone", name: "Aurora - dev", needsDeploy: ["api", "web"] },
    });
    expect(prompt).toContain("api, web");
  });

  it("tells a store-built environment which recipe it came up on", () => {
    const prompt = creationHandoffPrompt({ ...CLONED, source: { kind: "store" } });
    expect(prompt).toContain("the group's stage recipe");
  });

  it("gives an empty environment the setting-up job instead", () => {
    const prompt = creationHandoffPrompt({ ...CLONED, source: { kind: "none" } });
    expect(prompt).toContain("nothing in it yet");
    expect(prompt).not.toContain("cloned from");
  });

  it("says the group only when it adds something the name does not", () => {
    // "Aurora - stage" already carries "Aurora"; repeating it reads like a bug.
    expect(creationHandoffPrompt(CLONED)).not.toContain("in the Aurora project");
    expect(
      creationHandoffPrompt({ ...CLONED, environmentName: "Nightly", groupName: "Aurora" }),
    ).toContain("in the Aurora project");
  });

  it("ends by asking for a report, so the run has somewhere to land", () => {
    expect(creationHandoffPrompt(CLONED).trimEnd()).toMatch(/\.$/u);
    expect(creationHandoffPrompt(CLONED)).toContain("tell me");
  });
});

describe("creation handoff storage", () => {
  const handoff: ZeropsCreationHandoff = CLONED;

  it("keeps a handoff against the project, which is all a creation knows", () => {
    const stored = withCreationHandoff({}, { projectId: "proj-1" }, handoff);
    expect(readCreationHandoff(stored, { projectId: "proj-1" })).toEqual(handoff);
    expect(readCreationHandoff(stored, { environmentId: "env-1" })).toBeUndefined();
  });

  it("moves it onto the environment id the connect hands back", () => {
    const stored = withCreationHandoffPromoted(
      withCreationHandoff({}, { projectId: "proj-1" }, handoff),
      "proj-1",
      "env-1",
    );
    expect(readCreationHandoff(stored, { environmentId: "env-1" })).toEqual(handoff);
    // The project key is spent: a reconnect must not raise the job again.
    expect(readCreationHandoff(stored, { projectId: "proj-1" })).toBeUndefined();
  });

  it("leaves a connect for a project nobody created alone", () => {
    expect(withCreationHandoffPromoted({}, "proj-9", "env-9")).toEqual({});
  });

  it("forgets a handoff once its job has been started", () => {
    const stored = withCreationHandoffPromoted(
      withCreationHandoff({}, { projectId: "proj-1" }, handoff),
      "proj-1",
      "env-1",
    );
    expect(
      readCreationHandoff(withoutCreationHandoff(stored, "env-1"), { environmentId: "env-1" }),
    ).toBeUndefined();
  });

  it("reads anything unexpected as nothing stored", () => {
    for (const raw of [null, "", "[]", "{oops", '{"env:1":{"role":"nope"}}']) {
      expect(
        readCreationHandoff(parseCreationHandoffs(raw), { environmentId: "1" }),
      ).toBeUndefined();
    }
  });

  it("survives a round trip through the string it is stored as", () => {
    const stored = withCreationHandoff({}, { projectId: "proj-1" }, handoff);
    expect(
      readCreationHandoff(parseCreationHandoffs(JSON.stringify(stored)), { projectId: "proj-1" }),
    ).toEqual(handoff);
  });
});

describe("creationJobToStart", () => {
  const READY = {
    environmentId: "env-1",
    handoff: CLONED,
    hasTarget: true,
    ready: true,
    agentSignInRequired: false,
    startedFor: null,
  };

  it("says the job once everything it needs is there", () => {
    expect(creationJobToStart(READY)).toEqual(CLONED);
  });

  it.each([
    { name: "no environment yet", patch: { environmentId: null } },
    { name: "nowhere to say it", patch: { hasTarget: false } },
    { name: "the thread cannot take it", patch: { ready: false } },
    { name: "nothing was created here", patch: { handoff: undefined } },
    { name: "no agent is signed in", patch: { agentSignInRequired: true } },
    { name: "this caller already said it", patch: { startedFor: "env-1" } },
  ])("says nothing while $name", ({ patch }) => {
    expect(creationJobToStart({ ...READY, ...patch })).toBeUndefined();
  });

  it("still speaks for a different environment than the one already started", () => {
    expect(creationJobToStart({ ...READY, startedFor: "env-2" })).toEqual(CLONED);
  });

  it("waits rather than gives up: the same input answers again once it is ready", () => {
    expect(creationJobToStart({ ...READY, ready: false })).toBeUndefined();
    expect(creationJobToStart(READY)).toEqual(CLONED);
  });
});

describe("creationJobSendable", () => {
  it("sends when the provider is there and the job is in the composer", () => {
    expect(
      creationJobSendable({ providerAvailable: true, composerText: "Check what is running." }),
    ).toBe(true);
  });

  it("refuses while no provider will take it", () => {
    expect(
      creationJobSendable({ providerAvailable: false, composerText: "Check what is running." }),
    ).toBe(false);
  });

  /**
   * The job is written to the composer's store and read back from a ref that
   * the store fills on the next render. A send in the same tick reads the
   * empty ref, sends nothing, and — reported as sent — spends the handoff on
   * nothing. Measured on a second Mate: the prompt was written, the handoff
   * was gone, and the thread had no messages at all.
   */
  it("refuses an empty composer rather than reporting an empty send as sent", () => {
    expect(creationJobSendable({ providerAvailable: true, composerText: "" })).toBe(false);
  });

  it("reads whitespace as empty", () => {
    expect(creationJobSendable({ providerAvailable: true, composerText: "  \n\t " })).toBe(false);
  });
});
