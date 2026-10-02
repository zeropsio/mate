/**
 * *Add stage* and *Add production* through HQ (SPEC §3.2b, main D14): the project attached to its
 * application as its stage or production — HQ records the environment with it — then the
 * environment's deploy key minted by the person's client and handed to HQ. No pull request, no
 * broker; each step reports rather than throws, and asking again writes nothing twice.
 */
import { describe, expect, it, vi } from "vite-plus/test";

import type { HqEnvironment } from "@t3tools/client-runtime/zerops/hq";
import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";

import { addGroupEnvironment } from "./addGroupEnvironment";

/** As much of HQ as adding an environment calls. */
type HqFake = Pick<HqApi, "attachProject" | "structure" | "keepDeployToken">;

/** HQ's record of the stage of `g-1`, as its structure answers once the stage is attached. */
const RECORDED: HqEnvironment = {
  projectId: "p-stage",
  tier: "stage",
  name: "acme-stage",
  sources: ["main"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  deploys: [],
};

/** HQ, taking every attachment and every key, its structure holding `environments` for `g-1`. */
function hqFake(
  environments: ReadonlyArray<HqEnvironment> = [RECORDED],
  over: Partial<HqFake> = {},
): HqFake {
  return {
    structure: vi.fn(async () => ({
      ungrouped: [],
      apps: [
        {
          id: "g-1",
          name: "Acme",
          projects: [{ projectId: "p-stage", name: "Acme - stage", kind: "stage", mate: null }],
          environments,
        },
      ],
    })),
    attachProject: vi.fn(async () => undefined),
    keepDeployToken: vi.fn(async () => undefined),
    ...over,
  };
}

function apiFake() {
  return {
    mintIntegrationToken: vi.fn().mockResolvedValue({ id: "t-deploy", token: "the-stage-key" }),
    deleteIntegrationToken: vi.fn().mockResolvedValue(undefined),
  };
}

const add = (api: ReturnType<typeof apiFake>, hq: HqFake) =>
  addGroupEnvironment({
    client: api as never,
    hq,
    clientId: "org-1",
    groupId: "g-1",
    environment: { tier: "stage", project: "p-stage" },
  });

describe("addGroupEnvironment", () => {
  it("attaches the project as its tier, then hands HQ the key minted for that one project", async () => {
    const api = apiFake();
    const hq = hqFake();
    expect(await add(api, hq)).toEqual({ done: ["registry", "deploy-token"], failed: undefined });
    expect(hq.attachProject).toHaveBeenCalledWith("g-1", { projectId: "p-stage", kind: "stage" });
    expect(api.mintIntegrationToken).toHaveBeenCalledWith(
      {
        clientId: "org-1",
        name: "mate-hq-deploy:acme-stage:p-stage",
        roleCode: "NO_ACCESS",
        projects: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
      },
      undefined,
    );
    // Under the name HQ gave the environment.
    expect(hq.keepDeployToken).toHaveBeenCalledWith("g-1", "acme-stage", "the-stage-key");
  });

  it("mints nothing for an environment whose key HQ holds and finds working", async () => {
    const api = apiFake();
    const hq = hqFake([{ ...RECORDED, keyHeld: true }]);
    expect(await add(api, hq)).toEqual({ done: ["registry", "deploy-token"], failed: undefined });
    expect(api.mintIntegrationToken).not.toHaveBeenCalled();
  });

  // Main E07: a key HQ found broken is minted anew.
  it("mints a new key where HQ found the one it holds broken", async () => {
    const api = apiFake();
    const hq = hqFake([{ ...RECORDED, keyHeld: true, keyInvalid: true }]);
    await add(api, hq);
    expect(hq.keepDeployToken).toHaveBeenCalledTimes(1);
  });

  it("stops at the registry with HQ's refusal, minting nothing", async () => {
    const api = apiFake();
    const hq = hqFake([RECORDED], {
      attachProject: vi.fn(async () => {
        throw new HqError({
          kind: "refused",
          code: "forbidden",
          message: "You need Admin access to this Zerops project.",
        });
      }),
    });
    expect(await add(api, hq)).toEqual({
      done: [],
      failed: { step: "registry", reason: "You need Admin access to this Zerops project." },
    });
    expect(api.mintIntegrationToken).not.toHaveBeenCalled();
  });

  it("stops where HQ holds the project as no environment after the attach", async () => {
    const outcome = await add(apiFake(), hqFake([]));
    expect(outcome.done).toEqual(["registry"]);
    expect(outcome.failed?.step).toBe("deploy-token");
  });

  // Main E06: a key HQ never got is taken back, so no orphan of a failed write stays.
  it("takes the minted key back when HQ did not take it", async () => {
    const api = apiFake();
    const hq = hqFake([RECORDED], {
      keepDeployToken: vi.fn(async () => {
        throw new HqError({
          kind: "refused",
          code: "invalid",
          message: "Zerops did not accept this deploy key.",
        });
      }),
    });
    expect(await add(api, hq)).toEqual({
      done: ["registry"],
      failed: { step: "deploy-token", reason: "Zerops did not accept this deploy key." },
    });
    expect(api.deleteIntegrationToken).toHaveBeenCalledWith(
      { clientId: "org-1", tokenId: "t-deploy" },
      undefined,
    );
  });
});
