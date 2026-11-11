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
  reachabilityPhrase,
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

it.each(["denied", "deleted"] as const)(
  "a named Chief refusal survives generic %s project recovery",
  (kind) => {
    const reachability = { kind: "refused-role", chiefOwnerName: "Karlos" } as const;
    const recovery = { standing: { kind }, status: undefined, process: undefined };
    const result = mateArrival({
      press: undefined,
      candidate,
      link: link({ reachability }),
      recovery,
      listedOnly: true,
      cameUp: true,
      conversation: ready,
    });
    expect(result).toMatchObject({
      page: { kind: "unreachable", reachability },
      projectUnavailable: false,
      handover: "wait",
      arrival: undefined,
    });
    expect(
      mateNoticeDecision({
        reachability,
        recovery,
        mateName: "Vera",
        conversationShown: false,
        nowMs: 101,
      }),
    ).toMatchObject({
      phase: "reachability",
      recovery: null,
      recovering: false,
      actions: [],
    });
    expect(reachabilityPhrase(reachability, { mateName: "Vera", nowMs: 101 }).text).toBe(
      "This is Karlos's Chief Mate.",
    );
  },
);

it("a Chief owner's name arriving later replaces generic access-loss recovery", () => {
  const recovery = { standing: { kind: "denied" }, status: undefined, process: undefined } as const;
  const read = (reachability: MateLink["reachability"]) => {
    const arrival = mateArrival({
      press: undefined,
      candidate,
      link: link({ reachability }),
      recovery,
    });
    const page = arrival.page;
    return {
      arrival,
      notice: mateNoticeDecision({
        reachability: page?.kind === "unreachable" ? page.reachability : reachability,
        recovery,
        mateName: "Vera",
        conversationShown: false,
        nowMs: 101,
      }),
    };
  };
  expect(read({ kind: "connecting", waitingOn: "access" }).notice.phase).toBe("recovery");
  const named = { kind: "refused-role", chiefOwnerName: "Karlos" } as const;
  expect(read(named)).toMatchObject({
    arrival: { page: { kind: "unreachable", reachability: named }, projectUnavailable: false },
    notice: { phase: "reachability", recovery: null },
  });
});

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

describe("missing deployment arrival", () => {
  const undeployed = {
    group: "provisioning",
    service: { status: "READY_TO_DEPLOY", activeAppVersion: null },
  } as const;
  const missing = { kind: "failed", line: "Nothing is deployed yet.", verb: "redeploy" } as const;
  it.each([
    {
      sentence: "A Mate page with no deployment offers Redeploy before a link is known",
      heldLink: undefined,
    },
    {
      sentence: "A retained environment cannot turn a missing deployment into an opening Mate",
      heldLink: link({ reachability: { kind: "not-answering", overdue: true }, answered: false }),
    },
  ])("$sentence", ({ heldLink }) => {
    const result = mateArrival({
      press: undefined,
      candidate: undeployed,
      ...(heldLink === undefined ? {} : { link: heldLink }),
      cameUp: true,
    });
    expect(result.coming).toEqual(missing);
    expect(result.page).toEqual({ kind: "coming", coming: missing });
    expect(result.arrival).toEqual(missing);
    expect(result.handover).toBe("wait");
  });

  it("A deployment read after first paint replaces the starting message with Redeploy", () => {
    const unread = mateArrival({
      press: undefined,
      candidate: { group: "provisioning", service: { status: "READY_TO_DEPLOY" } },
    });
    expect(unread.arrival).toEqual({ kind: "coming", line: "Coming up. A few minutes." });
    const read = mateArrival({ press: undefined, candidate: undeployed });
    expect(read.arrival).toEqual(missing);
  });

  it.each(["deleted", "denied"] as const)(
    "%s owner evidence withholds a missing-deployment recovery",
    (kind) => {
      const result = mateArrival({
        press: undefined,
        candidate: undeployed,
        recovery: { standing: { kind }, status: undefined, process: undefined },
      });
      expect(result.coming).toBeUndefined();
      expect(result.arrival).toBeUndefined();
      expect(result.page?.kind).toBe("unreachable");
    },
  );
});

it.each(["process history", "setup projection"] as const)(
  "A missing deployment offers Redeploy despite an old failure in %s",
  (source) => {
    const oldFailure = {
      id: "old-setup",
      projectId: "p",
      serviceStackIds: ["s"],
      status: "FAILED",
      actionName: "stack.deploy",
      created: "2026-10-01T00:00:00Z",
    };
    const result = mateArrival({
      press: undefined,
      candidate: {
        group: "provisioning",
        service: { id: "s", status: "READY_TO_DEPLOY", activeAppVersion: null },
      },
      ...(source === "process history"
        ? { processes: [oldFailure] }
        : { setupFailure: oldFailure }),
    });
    expect(result.arrival).toEqual({
      kind: "failed",
      line: "Nothing is deployed yet.",
      verb: "redeploy",
    });
  },
);

it.each(["process history", "setup projection"] as const)(
  "An uncertain setup does not inherit an earlier attempt's failure from %s",
  (source) => {
    const oldFailure = {
      id: "old-setup",
      projectId: "p",
      serviceStackIds: ["s"],
      status: "FAILED",
      actionName: "stack.deploy",
      created: "2026-10-01T00:00:00Z",
    };
    const result = mateArrival({
      press: { container: true, uncertain: true, startedAt: Date.parse("2026-10-28T00:00:00Z") },
      candidate: { group: "provisioning", service: { id: "s", status: "CREATING" } },
      setUpFailed: "The setup write may have landed.",
      ...(source === "process history"
        ? { processes: [oldFailure] }
        : { setupFailure: oldFailure }),
    });
    expect(result.arrival).toMatchObject({
      kind: "coming",
      line: "The setup write may have landed.",
    });
  },
);
