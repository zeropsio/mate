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
