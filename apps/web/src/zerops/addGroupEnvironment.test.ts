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
  jobs: [],
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
    // Made for HQ to deploy: its services get their subdomain on their first deploy (audit R1).
    expect(hq.attachProject).toHaveBeenCalledWith("g-1", {
      projectId: "p-stage",
      kind: "stage",
      created: true,
    });
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
    expect(api.deleteIntegrationToken).toHaveBeenCalledWith({
      clientId: "org-1",
      tokenId: "t-deploy",
    });
  });

  // Audit K4: a handoff whose answer was lost may have been kept by HQ, which finishes a write its
  // client left (F22). The key is taken back only on HQ's refusal; a lost answer is read back.
  describe("a handoff whose answer was lost", () => {
    const lost = () =>
      vi.fn(async () => {
        throw new HqError({
          kind: "uncertain",
          code: "uncertain",
          message: "HQ's answer was lost.",
        });
      });
    /** HQ's structure: the stage unkeyed before the handoff, `held` read back after it. */
    const readBack = (held: boolean) => {
      const hq = hqFake([RECORDED], { keepDeployToken: lost() });
      const before = hq.structure;
      let reads = 0;
      return {
        ...hq,
        structure: vi.fn(async () => {
          reads += 1;
          const structure = await before();
          return reads === 1
            ? structure
            : {
                ...structure,
                apps: structure.apps.map((app) => ({
                  ...app,
                  environments: [{ ...RECORDED, keyHeld: held }],
                })),
              };
        }),
      };
    };

    it("keeps the key HQ read back as held, and takes nothing back", async () => {
      const api = apiFake();
      expect(await add(api, readBack(true))).toEqual({
        done: ["registry", "deploy-token"],
        failed: undefined,
      });
      expect(api.deleteIntegrationToken).not.toHaveBeenCalled();
    });

    it("takes back no key HQ does not hold yet: its write may still land", async () => {
      const api = apiFake();
      const outcome = await add(api, readBack(false));
      expect([outcome.done, outcome.failed?.step]).toEqual([["registry"], "deploy-token"]);
      expect(api.deleteIntegrationToken).not.toHaveBeenCalled();
    });
  });

  it("takes a refused key back even where its caller already left", async () => {
    const api = apiFake();
    const left = new AbortController();
    const hq = hqFake([RECORDED], {
      keepDeployToken: vi.fn(async () => {
        left.abort();
        throw new HqError({ kind: "refused", code: "invalid", message: "Refused." });
      }),
    });
    await addGroupEnvironment({
      client: api as never,
      hq,
      clientId: "org-1",
      groupId: "g-1",
      environment: { tier: "stage", project: "p-stage" },
      signal: left.signal,
    });
    expect(api.deleteIntegrationToken).toHaveBeenCalledTimes(1);
    const [, signal] = api.deleteIntegrationToken.mock.calls[0] as [unknown, AbortSignal?];
    expect(signal?.aborted ?? false).toBe(false);
  });
});
