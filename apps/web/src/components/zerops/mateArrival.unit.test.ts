import { expect, it } from "vite-plus/test";
import { arrivalLink, LINK_REFUSAL_WORDS } from "../../zerops/mateArrival.ts";

const mate = { name: "Wren", project: "Shop" };
const NOW = Date.parse("2026-11-24T10:00:00.000Z");
const refusal = (code: string) => ({ code, at: "2026-11-24T09:55:00.000Z" });

/** Whose words the sentence says: a code's own, the generic sentence, or none. */
const said = (sentence: string | undefined) =>
  sentence === undefined
    ? "none"
    : (Object.keys(LINK_REFUSAL_WORDS).find((code) =>
        sentence.startsWith(LINK_REFUSAL_WORDS[code]!(mate.name)),
      ) ?? (sentence.startsWith("HQ could not link Wren.") ? "generic" : "other"));

// witness: apps/web/src/zerops/mateArrival.ts | if (input.link !== "coming" || input.containerFailed) return { refused: null, tryNow: true }; → if (input.link !== "coming") return { refused: null, tryNow: true };
it("MN+1: A new Mate HQ says is coming offers no Try now unless its container failed at Zerops, and turns failed with HQ's reason for each refusal code HQ put on its birth, a code this build does not know in its details; breaks: Try now on a Mate with no server does nothing, a refused Mate waits as coming forever, or a failed container loses its stop and start", () => {
  const rows = [
    // HQ link, failed at Zerops, refusal → failed, whose words, details, Try now.
    ["coming", false, null, false, "none", undefined, false],
    ...Object.keys(LINK_REFUSAL_WORDS).map(
      (code) => ["coming", false, refusal(code), true, code, undefined, false] as const,
    ),
    ["coming", false, refusal("key_lost"), true, "generic", "key_lost", false],
    ["coming", true, null, false, "none", undefined, true],
    ["coming", true, refusal("key_refused"), false, "none", undefined, true],
    ["live", false, refusal("key_refused"), false, "none", undefined, true],
    ["live", true, null, false, "none", undefined, true],
    ["offline", false, refusal("not_a_mate"), false, "none", undefined, true],
  ] as const;
  expect(Object.keys(LINK_REFUSAL_WORDS).toSorted()).toEqual([
    "key_not_sensitive",
    "key_refused",
    "key_too_wide",
    "not_a_mate",
  ]);
  expect(
    rows.map(([link, containerFailed, given]) => {
      const answer = arrivalLink(mate, { link, containerFailed, refusal: given, nowMs: NOW });
      return [
        link,
        containerFailed,
        given,
        answer.refused !== null,
        said(answer.refused?.sentence),
        answer.refused?.details,
        answer.tryNow,
      ];
    }),
  ).toEqual(rows);
});
