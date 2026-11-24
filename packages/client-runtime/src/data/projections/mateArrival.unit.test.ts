import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  initialEnvironment,
  selectReachability,
  type MateLink,
  type Reachability,
} from "../../zerops/environments/index.ts";
import type { ZeropsProject } from "../../zerops/api/project.ts";
import { deriveZeropsCandidates } from "../../zerops/candidates.ts";
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

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | (reachability?.kind === "refused-role" || → (false ||
it("PJ121: A viewer refused a Mate, or one who may not operate its project while it is not up, is told of their access and offered only Go to projects, whatever its container's state, and only one who may operate a stopped Mate is told to start it; breaks: a Read only viewer of a stopped Mate is told to Start it and offered Try again", () => {
  const stopped = { standing: { kind: "unknown" }, status: "STOPPED", process: undefined } as const;
  const down = { kind: "container", container: { level: "inactive", status: "STOPPED" } } as const;
  const on = { recovery: stopped, mateName: "Ada", conversationShown: false, nowMs: 0 };
  const access = { phase: "access", recovery: null, actions: ["go-to-projects"] };
  expect(mateNoticeDecision({ ...on, reachability: { kind: "refused-role" } })).toMatchObject(
    access,
  );
  expect(
    mateNoticeDecision({ ...on, reachability: { kind: "refused-role" }, operates: true }),
  ).toMatchObject(access);
  expect(mateNoticeDecision({ ...on, reachability: down, operates: false })).toMatchObject(access);
  expect(mateNoticeDecision({ ...on, reachability: down, operates: true })).toMatchObject({
    phase: "recovery",
    actions: ["start"],
  });
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | if (candidate?.missingContainer === true) return { kind: "no-container" }; → if (candidate?.missingContainer === true) return { kind: "reaching", reachability };
it("PJ139: A Mate whose project holds no container reads as having none while no birth or press brings one, whatever status Zerops gives the project, and as coming only while one does; breaks: a Mate nothing is setting up says it is coming up and its Set up Mate is never offered", () => {
  for (const status of ["NEW", "CREATING", "ACTIVE"]) {
    const project = { id: "p", name: "Quinn", status } as unknown as ZeropsProject;
    const [listed] = deriveZeropsCandidates(project, [], new Map());
    const nothing = mateArrival({ candidate: listed, nowMs: 1 });
    expect([status, nothing.coming, nothing.page?.kind]).toEqual([
      status,
      undefined,
      "no-container",
    ]);
    const pressed = mateArrival({ candidate: listed, nowMs: 1, press: { container: true } });
    expect([status, pressed.page?.kind]).toEqual([status, "coming"]);
  }
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | input.mateState?.state === "cannot_run" → input.mateState != null
it("PJ+2: A connected Mate HQ says cannot work speaks one notice over its conversation, ahead of its key's word, and HQ's other verdicts, or a Mate not connected, keep their own; breaks: a signed-out Mate's page says nothing while it cannot answer, or a Mate HQ calls online or offline is told it cannot work", () => {
  const ready = { kind: "ready", notice: null } as const;
  const on = { mateName: "Ada", conversationShown: true, nowMs: 0 };
  const verdict = (state: string) => ({ state, since: undefined, why: "signed_out" });
  const phase = (input: Partial<Parameters<typeof mateNoticeDecision>[0]>) =>
    mateNoticeDecision({ ...on, reachability: ready, ...input }).phase;
  expect(phase({ mateState: verdict("cannot_run") })).toBe("cannot-run");
  expect(phase({ mateState: verdict("cannot_run"), hqKey: { state: "unresolved" } })).toBe(
    "cannot-run",
  );
  expect(phase({ mateState: verdict("cannot_run"), conversationShown: false })).toBe("none");
  expect(phase({ mateState: verdict("cannot_run"), reachability: { kind: "reconnecting" } })).toBe(
    "reachability",
  );
  expect([
    phase({ mateState: verdict("online") }),
    phase({ mateState: verdict("offline") }),
    phase({ mateState: null }),
  ]).toEqual(["none", "none", "none"]);
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | input.mateState?.state === "offline" && → false &&
it("PJ+3: A Mate HQ says is offline, its link not live, says HQ's verdict with Open in Zerops on whatever its link would say, opening, reconnecting or not answering, and a live link, a recovery or a restart keeps its own; breaks: its page flips between opening the conversation and not answering, without HQ's since", () => {
  const offline = { state: "offline", since: "2026-11-24T09:43:46.130Z", why: "link_closed" };
  const on = { mateName: "Ada", conversationShown: false, nowMs: 0, mateState: offline };
  const decide = (reachability: Reachability | null) => {
    const { phase, actions, surface } = mateNoticeDecision({ ...on, reachability });
    return { phase, actions, surface };
  };
  const said = { phase: "offline", actions: ["open-in-zerops"], surface: "stage" };
  // The link's verdict while HQ says offline: the decision.
  const table: ReadonlyArray<readonly [Reachability | null, string]> = [
    [null, "offline"],
    [{ kind: "connecting", waitingOn: "exchange" }, "offline"],
    [{ kind: "reconnecting" }, "offline"],
    [{ kind: "not-answering", overdue: false }, "offline"],
    [{ kind: "ready", notice: null }, "none"],
    [{ kind: "gone", because: "direct-not-found" }, "reachability"],
  ];
  for (const [reachability, phase] of table)
    expect({ reachability, phase: decide(reachability).phase }).toEqual({ reachability, phase });
  expect(decide({ kind: "reconnecting" })).toEqual(said);
});

// witness: packages/client-runtime/src/data/projections/mateArrival.ts | : input.restartOpen === true → : false
it("PJ+4: While HQ's restart of a Mate is open its page says one stage, restarting, with no verb, whatever its container, its link or HQ's verdict say, and in HQ's relink grace its link says only that it reconnects; breaks: a restart pressed flips between not answering, stopped and starting with Restart offered again, and a Mate whose link closed reads as restarting while nothing restarts", () => {
  const offline = { state: "offline", since: "2026-11-24T10:06:56.977Z", why: "link_closed" };
  const stopped = { standing: { kind: "unknown" }, status: "STOPPED", process: undefined } as const;
  const starting = {
    standing: { kind: "unknown" },
    status: "ACTIVE",
    process: undefined,
    lifecycle: { state: "running", verb: "start", cause: "", actions: [] },
  } as const;
  // What a container reads while its link is closed and no probe answers it.
  const quiet: Reachability = {
    kind: "container",
    container: { level: "booting", overdue: false, guessed: true },
  };
  const lost: Reachability = { kind: "reconnecting" };
  const ready: Reachability = { kind: "ready", notice: null };
  const gone: Reachability = { kind: "gone", because: "direct-not-found" };
  const on = { mateName: "Basil", conversationShown: false, nowMs: 0 };
  type Input = Partial<Parameters<typeof mateNoticeDecision>[0]>;
  // HQ's open restart × HQ's grace × the container, link and verdict: the stage and its verbs.
  const table: ReadonlyArray<readonly [Input, phase: string, actions: ReadonlyArray<string>]> = [
    [{ restartOpen: true, reachability: lost, mateState: offline }, "restarting", []],
    [{ restartOpen: true, reachability: lost, recovery: stopped }, "restarting", []],
    [{ restartOpen: true, reachability: lost, recovery: starting }, "restarting", []],
    [{ restartOpen: true, reachability: quiet }, "restarting", []],
    [{ restartOpen: true, reachability: ready, conversationShown: true }, "restarting", []],
    [{ restartOpen: true, reachability: gone }, "reachability", ["go-to-projects"]],
    [{ restartOpen: false, reachability: lost, mateState: offline }, "offline", ["open-in-zerops"]],
    [{ relinking: true, reachability: quiet }, "relinking", []],
    [{ relinking: true, reachability: lost }, "relinking", []],
    [{ relinking: true, reachability: quiet, conversationShown: true }, "relinking", []],
    [{ relinking: true, reachability: ready, conversationShown: true }, "none", []],
    [{ relinking: true, restartOpen: true, reachability: quiet }, "restarting", []],
  ];
  for (const [input, phase, actions] of table) {
    const decision = mateNoticeDecision({ ...on, reachability: null, ...input });
    expect({ input, phase: decision.phase, actions: decision.actions }).toEqual({
      input,
      phase,
      actions,
    });
  }
});
