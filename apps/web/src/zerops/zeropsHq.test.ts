import { BridgeUnavailable } from "@zerops/session/session.bridge-client";
import type { SignInOptions, ZeropsSessionClient } from "@zerops/session/session.client";
import { DeviceLoginError } from "@zerops/session/session.device-login";
import { describe, expect, it } from "vite-plus/test";

import { makeZeropsHqPrompts } from "./zeropsHq";

/** A session client whose sign-ins end as `answer` says, recording what each asked. */
function fakeClient(answer: () => Promise<null>, mode: "bridge" | null = "bridge") {
  const asked: SignInOptions[] = [];
  const client: ZeropsSessionClient = {
    ready: async () => null,
    mode: () => mode,
    current: () => null,
    frameSizes: () => null,
    rejected: async () => null,
    changes: () => () => undefined,
    signOut: async () => undefined,
    signIn: (options = {}) => {
      asked.push(options);
      return answer();
    },
    reopenSignIn: () => true,
    sudo: async () => undefined,
    reopenSudo: () => true,
    takeCarry: async () => null,
  };
  return { client, asked };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Zerops HQ's prompts", () => {
  // The person may have made their account before the window ended: a second sign-up would refuse
  // their address, and Zerops's sign-in offers to create an account to whoever has none.
  // witness: apps/web/src/zerops/zeropsHq.ts | signIn(state.phase === "failed" ? undefined : (state.intent ?? undefined)); → signIn(state.intent ?? undefined);
  it("Try again after a sign-up that did not finish reopens sign-in, never sign-up", async () => {
    const { client, asked } = fakeClient(() => Promise.reject(new DeviceLoginError("failed")));
    const prompts = makeZeropsHqPrompts(client, { scheme: () => "light", reload: () => undefined });

    prompts.signIn("register");
    await settle();
    expect(prompts.state()).toMatchObject({ kind: "sign-in", phase: "failed" });
    prompts.retry();

    expect(asked.map(({ intent }) => intent)).toEqual(["register", undefined]);
  });

  // witness: apps/web/src/zerops/zeropsHq.ts | ports.reload(); → void 0;
  it("Try again loads the page again while Zerops HQ never answered it", async () => {
    let reloads = 0;
    const { client, asked } = fakeClient(() => Promise.reject(new BridgeUnavailable()), null);
    const prompts = makeZeropsHqPrompts(client, {
      scheme: () => "light",
      reload: () => {
        reloads += 1;
      },
    });

    prompts.signIn();
    await settle();
    expect(prompts.state()).toMatchObject({ kind: "sign-in", phase: "unreachable" });
    prompts.retry();

    expect(reloads).toBe(1);
    expect(asked).toHaveLength(1);
  });
});
