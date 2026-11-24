import { expect, it } from "vite-plus/test";
import type { BirthStepState } from "@t3tools/client-runtime/zerops/birthProgress";
import {
  arrivalLink,
  arrivalRow,
  arrivalSteps,
  LINK_REFUSAL_WORDS,
} from "../../zerops/mateArrival.ts";

const mate = { name: "Wren", project: "Shop" };
const NOW = Date.parse("2026-11-24T10:00:00.000Z");
const refusal = (code: string) => ({ code, at: "2026-11-24T09:55:00.000Z" });

/** Whose words the line says: a code's own, the generic sentence, or none. */
const said = (line: string | undefined) =>
  line === undefined
    ? "none"
    : (Object.keys(LINK_REFUSAL_WORDS).find((code) =>
        line.startsWith(LINK_REFUSAL_WORDS[code]!(mate.name)),
      ) ?? (line.startsWith("HQ could not link Wren.") ? "generic" : "other"));

// witness: apps/web/src/zerops/mateArrival.ts | if (input.link !== "coming" || containerFailed) → if (input.link !== "coming")
it("MN75: A new Mate HQ says is coming offers no Try now unless its container failed at Zerops, and turns failed with HQ's reason for each refusal code HQ put on its birth, a code this build does not know in its details, its way out its birth's Delete; breaks: Try now on a Mate with no server does nothing, a refused Mate waits as coming forever or offers a Delete HQ does not, or a failed container loses its stop and start", () => {
  const rows = [
    // HQ link, container status at Zerops, refusal → shown kind, verb, whose words, details,
    // Try now, which Delete.
    ["coming", "ACTIVE", null, "none", undefined, "none", undefined, false, "entry"],
    ["coming", undefined, null, "none", undefined, "none", undefined, false, "entry"],
    ...Object.keys(LINK_REFUSAL_WORDS).map(
      (code) =>
        [
          "coming",
          "ACTIVE",
          refusal(code),
          "failed",
          "remove",
          code,
          undefined,
          false,
          "birth",
        ] as const,
    ),
    [
      "coming",
      "ACTIVE",
      refusal("key_lost"),
      "failed",
      "remove",
      "generic",
      "key_lost",
      false,
      "birth",
    ],
    ["coming", "FAILED", null, "none", undefined, "none", undefined, true, "entry"],
    [
      "coming",
      "SERVICE_ACTION_FAILED",
      refusal("key_refused"),
      "none",
      undefined,
      "none",
      undefined,
      true,
      "entry",
    ],
    ["live", "ACTIVE", refusal("key_refused"), "none", undefined, "none", undefined, true, "entry"],
    ["live", "FAILED", null, "none", undefined, "none", undefined, true, "entry"],
    [
      "offline",
      "ACTIVE",
      refusal("not_a_mate"),
      "none",
      undefined,
      "none",
      undefined,
      true,
      "entry",
    ],
  ] as const;
  expect(Object.keys(LINK_REFUSAL_WORDS).toSorted()).toEqual([
    "key_not_sensitive",
    "key_refused",
    "key_too_wide",
    "not_a_mate",
  ]);
  expect(
    rows.map(([link, containerStatus, given]) => {
      const answer = arrivalLink(mate, { link, containerStatus, refusal: given, nowMs: NOW });
      const shown = answer.refused;
      return [
        link,
        containerStatus,
        given,
        shown?.kind ?? "none",
        shown?.kind === "failed" ? shown.verb : undefined,
        said(shown?.line),
        shown?.kind === "failed" ? shown.details : undefined,
        answer.tryNow,
        answer.exit,
      ];
    }),
  ).toEqual(rows);
});

// witness: apps/web/src/zerops/mateArrival.ts | if (progress.linkRefused === true) { → if (false) {
it("MN76: A new Mate whose hello HQ refused stops its arrival's row on the step that waited for that hello, failed, and nowhere else; breaks: the failed page still spins on Starting under its failed headline", () => {
  const birth = (mate: BirthStepState, connect: BirthStepState) =>
    [
      { id: "project", label: "Project", state: "done" },
      { id: "container", label: "Container", state: "done" },
      { id: "mate", label: "Mate", state: mate },
      { id: "connect", label: "Connect", state: connect },
    ] as const;
  const rows = [
    // Mate step, connect step, HQ refused its hello → the row's state, the step it is on.
    ["active", "waiting", false, "running", "start"],
    ["active", "waiting", true, "failed", "start"],
    ["done", "active", true, "failed", "open"],
    ["done", "done", true, "running", "you"],
  ] as const;
  expect(
    rows.map(([mateStep, connect, linkRefused]) => {
      const steps = birth(mateStep, connect);
      const shown = arrivalSteps({ steps, linkRefused }, mate);
      const row = arrivalRow(shown, steps);
      return [mateStep, connect, linkRefused, row.state, shown[row.at]?.id];
    }),
  ).toEqual(rows);
});
