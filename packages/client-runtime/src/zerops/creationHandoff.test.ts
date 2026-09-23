import { describe, expect, it } from "vite-plus/test";

import {
  creationJobSendable,
  creationHandoffPrompt,
  creationJobToStart,
  type ZeropsCreationHandoff,
} from "./creationHandoff.ts";

const FROM_TIER: ZeropsCreationHandoff = {
  environmentName: "Aurora - stage",
  groupName: "Aurora",
  role: "stage",
  source: { kind: "tier", services: ["app"] },
};

describe("creationHandoffPrompt", () => {
  it("names what the environment is, where it came from, and the job", () => {
    const prompt = creationHandoffPrompt(FROM_TIER);
    expect(prompt).toContain("Aurora - stage");
    expect(prompt).toContain("stage environment");
    expect(prompt).toContain("Aurora");
    expect(prompt).toContain("the project's recipe");
    expect(prompt).toContain("app");
  });

  it("says nothing about deploying a tier that declared no services", () => {
    const prompt = creationHandoffPrompt({
      ...FROM_TIER,
      source: { kind: "tier", services: [] },
    });
    expect(prompt).not.toContain("deploy");
    expect(prompt).toContain("the project's recipe");
  });

  // A second Mate's services are the app the first Mate built: their code is
  // on Gitea, and a Mate that writes a new app has joined nothing.
  it("sends a Mate made from the recipe to the group's code on Gitea", () => {
    const prompt = creationHandoffPrompt({
      ...FROM_TIER,
      environmentName: "Aurora - Ada",
      role: "dev",
    });
    expect(prompt).toContain("Their code is on the project's Gitea, on main");
    expect(prompt).toContain("never a new app");
    expect(creationHandoffPrompt(FROM_TIER)).not.toContain("Gitea");
  });

  it("lists every service that needs one, not just the first", () => {
    const prompt = creationHandoffPrompt({
      ...FROM_TIER,
      source: { kind: "tier", services: ["api", "web"] },
    });
    expect(prompt).toContain("api, web");
  });

  it("gives an empty environment the setting-up job instead", () => {
    const prompt = creationHandoffPrompt({ ...FROM_TIER, source: { kind: "none" } });
    expect(prompt).toContain("nothing in it yet");
    expect(prompt).not.toContain("the project's recipe");
  });

  it("says the group only when it adds something the name does not", () => {
    // "Aurora - stage" already carries "Aurora"; repeating it reads like a bug.
    expect(creationHandoffPrompt(FROM_TIER)).not.toContain("in the Aurora project");
    expect(
      creationHandoffPrompt({ ...FROM_TIER, environmentName: "Nightly", groupName: "Aurora" }),
    ).toContain("in the Aurora project");
  });

  it("ends by asking for a report, so the run has somewhere to land", () => {
    expect(creationHandoffPrompt(FROM_TIER).trimEnd()).toMatch(/\.$/u);
    expect(creationHandoffPrompt(FROM_TIER)).toContain("tell me");
  });
});

describe("creationJobToStart", () => {
  const READY = {
    environmentId: "env-1",
    handoff: FROM_TIER,
    hasTarget: true,
    ready: true,
    agentSignInRequired: false,
    startedFor: null,
  };

  it("fills the composer with a generated hand-off and leaves it there", () => {
    expect(creationJobToStart(READY)).toEqual({
      kind: "compose",
      prompt: creationHandoffPrompt(FROM_TIER),
    });
  });

  it("sends the person's own words, and only those (D17)", () => {
    expect(
      creationJobToStart({
        ...READY,
        handoff: { ...FROM_TIER, brief: "A CRM for our sales team." },
      }),
    ).toEqual({ kind: "send", prompt: "A CRM for our sales team." });
  });

  it("treats a blank answer as no answer rather than sending nothing", () => {
    expect(creationJobToStart({ ...READY, handoff: { ...FROM_TIER, brief: "  \n " } })).toEqual({
      kind: "compose",
      prompt: creationHandoffPrompt(FROM_TIER),
    });
  });

  it.each([
    { name: "no environment yet", patch: { environmentId: null } },
    { name: "nowhere to say it", patch: { hasTarget: false } },
    { name: "the thread cannot take it", patch: { ready: false } },
    { name: "nothing was created here", patch: { handoff: undefined } },
    { name: "no agent is signed in", patch: { agentSignInRequired: true } },
    { name: "this caller already said it", patch: { startedFor: "env-1" } },
  ])("waits while $name", ({ patch }) => {
    expect(creationJobToStart({ ...READY, ...patch })).toEqual({ kind: "wait" });
  });

  it("still speaks for a different environment than the one already started", () => {
    expect(creationJobToStart({ ...READY, startedFor: "env-2" }).kind).toBe("compose");
  });

  it("waits rather than gives up: the same input answers again once it is ready", () => {
    expect(creationJobToStart({ ...READY, ready: false })).toEqual({ kind: "wait" });
    expect(creationJobToStart(READY).kind).toBe("compose");
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
