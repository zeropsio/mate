import { describe, expect, it } from "vite-plus/test";
import { mateArrival } from "./mateArrival.ts";

const ready = {
  connected: true,
  shell: "live",
  hasConversation: true,
  detail: "live",
  detailHeld: true,
  signInKnown: true,
  cameUp: true,
} as const;
describe("arrival source evidence", () => {
  it.each([
    { patch: {}, want: "conversation" },
    { patch: { connected: false }, want: "wait" },
    { patch: { signInKnown: false }, want: "wait" },
    { patch: { detail: "synchronizing" }, want: "wait" },
    { patch: { hasConversation: false, shell: "empty" }, want: "wait" },
    { patch: { hasConversation: false, shell: "cached" }, want: "wait" },
    { patch: { hasConversation: false }, want: "create-conversation" },
    { patch: { cameUp: false, detail: "cached" }, want: "conversation" },
  ] as const)("$patch → $want", ({ patch, want }) => {
    const input = { ...ready, ...patch };
    expect(
      mateArrival({
        press: undefined,
        candidate: undefined,
        cameUp: input.cameUp,
        link: {
          key: "p:s",
          environmentId: input.connected
            ? ("env" as import("@t3tools/contracts").EnvironmentId)
            : undefined,
          reachability: input.connected
            ? { kind: "ready", notice: null }
            : { kind: "reconnecting" },
          failuresSinceConnect: 0,
          errorsSinceConnect: 0,
          answered: input.connected,
        },
        conversation: input,
      }).handover,
    ).toBe(want);
  });
});

import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  selectReachability,
  type MateLink,
} from "../../zerops/environments/index.ts";
import { mateNoticeDecision } from "./mateArrival.ts";

const environmentId = EnvironmentId.make("env");
const candidate = { group: "ready", service: { status: "ACTIVE" } } as const;
function link(patch: Partial<MateLink> = {}): MateLink {
  return {
    key: "p:s",
    environmentId,
    reachability: { kind: "ready", notice: null },
    answered: true,
    failuresSinceConnect: 0,
    errorsSinceConnect: 0,
    ...patch,
  };
}

it("a browser socket loss keeps a ready container out of renewed creation and restart", () => {
  const machine = {
    ...initialEnvironment({ record: environmentId }),
    presence: { kind: "present", origin: "https://mate.test" } as const,
    container: { level: "ready" } as const,
    credential: {
      kind: "held",
      environmentId,
      installed: true,
      staleBlock: false,
      rereading: null,
    } as const,
    linkLostAt: { wall: 100, mono: 100 },
  };
  const reachability = selectReachability(machine, environmentId);
  const result = mateArrival({
    press: undefined,
    candidate,
    link: link({ reachability }),
    cameUp: false,
  });
  expect(result.coming).toBeUndefined();
  expect(result.arrival).toBeUndefined();
  expect(
    mateNoticeDecision({ reachability, mateName: "Vera", conversationShown: true, nowMs: 101 }),
  ).toMatchObject({ phase: "reachability", actions: ["open-in-zerops"], recoveringRestart: false });
});

it("a machine that connected outranks a listing still provisioning its container", () => {
  expect(
    mateArrival({
      press: undefined,
      candidate: { group: "provisioning", service: { status: "CREATING" } },
      created: true,
      link: link(),
    }).coming,
  ).toBeUndefined();
});

it.each(["deleted", "denied"] as const)(
  "%s owner evidence stops a retained environment and arrival",
  (kind) => {
    const result = mateArrival({
      press: undefined,
      candidate,
      created: true,
      cameUp: true,
      link: link(),
      recovery: { standing: { kind }, status: undefined, process: undefined },
      conversation: ready,
    });
    expect(result).toMatchObject({
      coming: undefined,
      arrival: undefined,
      handover: "wait",
      page: {
        kind: "unreachable",
        reachability: {
          kind: "gone",
          because: kind === "deleted" ? "direct-not-found" : "direct-forbidden",
        },
      },
    });
  },
);

it("a registered environment alone never hands over an unread conversation", () => {
  expect(
    mateArrival({
      press: undefined,
      candidate,
      link: link({ reachability: { kind: "reconnecting" } }),
      conversation: ready,
    }).handover,
  ).toBe("wait");
});

it.each([0, 1, 2, 3, 4, 5])(
  "arrival keeps the first three unanswered link failures (%s)",
  (failures) => {
    const result = mateArrival({
      press: undefined,
      candidate,
      cameUp: true,
      link: link({
        environmentId: undefined,
        reachability: { kind: "reconnecting" },
        failuresSinceConnect: failures,
      }),
    });
    expect(result.arrival).toEqual(
      failures <= 3 ? { kind: "coming", line: "Almost there." } : undefined,
    );
  },
);
