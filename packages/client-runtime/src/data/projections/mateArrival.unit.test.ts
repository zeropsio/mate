import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  selectReachability,
  type MateLink,
} from "../../zerops/environments/index.ts";
import { mateArrival, mateNoticeDecision } from "./mateArrival.ts";
const ready = {
  connected: true,
  shell: "live",
  hasConversation: true,
  detail: "live",
  detailHeld: true,
  signInKnown: true,
  cameUp: true,
} as const;
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
// witness: packages/client-runtime/src/data/projections/mateArrival.ts | standing?.kind === "deleted" || standing?.kind === "denied" → standing?.kind === "deleted"
it("PJ60: A project its owner says is deleted or denied stops a retained environment and the arrival", () => {
  for (const kind of ["deleted", "denied"] as const) {
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
  }
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | if (!input.cameUp) return undefined; → if (input.cameUp) return undefined;
it("PJ66: A browser socket loss keeps a ready container out of renewed creation and restart", () => {
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

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | return input.signInKnown && ( → return (
it("PJ85: A Mate's arrival hands over to its conversation only once it is connected, the conversation is read and its sign-in is known; breaks: the person lands on a conversation that then flips to a sign-in prompt.", () => {
  const input = { press: undefined, candidate, link: link(), cameUp: true, conversation: ready };
  expect(
    mateArrival({ ...input, link: link({ reachability: { kind: "reconnecting" } }) }).handover,
  ).toBe("wait");
  expect(
    mateArrival({ ...input, conversation: { ...ready, detail: "synchronizing" } }).handover,
  ).toBe("wait");
  expect(mateArrival({ ...input, conversation: { ...ready, signInKnown: false } }).handover).toBe(
    "wait",
  );
  expect(mateArrival(input).handover).toBe("conversation");
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | input.shell === "live" ? "create-conversation" : "wait" → "create-conversation"
it("PJ86: A connected Mate with no conversation gets one made only while its shell is live; breaks: a second main conversation is made from a list that was not read yet.", () => {
  const input = { press: undefined, candidate, link: link(), cameUp: true };
  const conversation = { ...ready, hasConversation: false };
  expect(
    mateArrival({ ...input, conversation: { ...conversation, shell: "synchronizing" } }).handover,
  ).toBe("wait");
  expect(mateArrival({ ...input, conversation }).handover).toBe("create-conversation");
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | const failing = context.failuresSinceConnect > ARRIVAL_FAILURES_HELD; → const failing = false;
it("PJ87: An arrival holds its board through its link's first three failures and then lets the link's words speak; breaks: a new Mate warming up reads as not answering, or one that never answers keeps saying it is coming.", () => {
  const boardAfter = (failuresSinceConnect: number) =>
    mateArrival({
      press: undefined,
      candidate,
      cameUp: true,
      link: link({
        environmentId: undefined,
        answered: false,
        reachability: { kind: "connecting", waitingOn: "exchange" },
        failuresSinceConnect,
      }),
    }).arrival;
  expect(boardAfter(3)).toMatchObject({ kind: "coming" });
  expect(boardAfter(4)).toBeUndefined();
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | return !reachability.overdue; → return false;
it("PJ88: A Mate whose computer is up and has not answered stays coming until its wait is past its cap; breaks: the seconds in which a new Mate is installed and starts read as a Mate that isn't answering.", () => {
  const coming = (overdue: boolean) =>
    mateArrival({
      press: undefined,
      candidate,
      created: true,
      link: link({
        environmentId: undefined,
        answered: false,
        reachability: { kind: "not-answering", overdue },
      }),
    }).coming;
  expect(coming(false)).toMatchObject({ kind: "coming" });
  expect(coming(true)).toBeUndefined();
});
