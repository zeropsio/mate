import { expect, it } from "vite-plus/test";
import { keyRenewFailureWords, keyRenewOffer } from "../../../zerops/renewDeployKey.logic.ts";
import { operationFailureWords, type HqOperationStanding } from "@t3tools/client-runtime/data";
import {
  changeMergeVerdict,
  type ChangeReviewInput,
} from "@t3tools/client-runtime/zerops/reviewVerdict";
import {
  changeFixOptions,
  crewLandCommand,
  descriptionPicture,
  mergeStages,
  releaseChangeRows,
  whySaid,
} from "./ZeropsReview.logic.ts";

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | branch: pull.branch, → branch: undefined,
it("RV1: A change that conflicts with main asks its branch's conversation to resolve it, about the change at its head", () => {
  const options = changeFixOptions({
    branch: "badge",
    repositoryUrl: "https://github.com/acme/apidev",
    repository: "apidev",
    number: 1,
    headSha: "4f1c2e9",
  });
  expect(options.branch).toBe("badge");
  expect(options.repositoryUrl).toBe("https://github.com/acme/apidev");
  expect(options.about).toEqual({ kind: "change", repo: "apidev", number: 1, head: "4f1c2e9" });
});

const hq = "https://hq.bakery.test";
const picturePath = "/api/apps/app-bakery/changes/web/12/attachments/pic-7";

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | return hqAddress !== undefined && parseAttachmentUrl(url.href, hqAddress) !== null → return parseAttachmentUrl(url.href, hqAddress ?? url.origin) !== null
it("RV2: A description picture is read as the person's only when it is a change's picture at the official HQ's own origin, and none is while the official HQ is unknown", () => {
  expect(descriptionPicture(picturePath, hq)).toEqual({ kind: "hq", url: `${hq}${picturePath}` });
  expect(descriptionPicture(`https://hq.bakery.test.evil.example${picturePath}`, hq).kind).toBe(
    "elsewhere",
  );
  expect(descriptionPicture(`${hq}/files/loaf.png`, hq).kind).toBe("elsewhere");

  expect(descriptionPicture(`${hq}${picturePath}`, undefined).kind).not.toBe("hq");
  expect(descriptionPicture(picturePath, undefined).kind).toBe("none");
});

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | const entry = change === null ? key : `${repository}#${String(change.number)}`; → const entry = change === null ? key : `#${String(change.number)}`;
it("RV3: A release's rows open each change in the repository it was compared in, change numbers being per repository", () => {
  const landed = (sha: string, number: number, title: string) => ({
    sha,
    subject: `${title} (#${String(number)})`,
    authorName: "Rye",
    at: "2026-11-19T10:00:00Z",
    change: { number, title, mateProjectId: "Z_RYE" },
  });
  const rows = releaseChangeRows({
    moved: [
      {
        repository: "web",
        services: ["web"],
        commits: [landed("a".repeat(40), 3, "Bigger loaves")],
        total: 1,
        truncated: false,
      },
      {
        repository: "api",
        services: ["api"],
        commits: [landed("b".repeat(40), 3, "Faster checkout")],
        total: 1,
        truncated: false,
      },
    ],
    marks: new Map(),
  });
  expect(rows.map((row) => row.change)).toEqual([
    { repository: "web", number: 3 },
    { repository: "api", number: 3 },
  ]);
});

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | _tag: task.state === "working" || task.state === "rework" ? "landNow" : "land", → _tag: task.state === "working" ? "landNow" : "land",
it("RV4: Land now is pressed only for a crew task still working or sent back for rework; ready, in-review and waiting-on-you tasks are landed with land", () => {
  const tagOf = (state: string) => crewLandCommand({ id: `task-${state}`, state })._tag;
  expect(tagOf("working")).toBe("landNow");
  expect(tagOf("rework")).toBe("landNow");
  expect(tagOf("ready")).toBe("land");
  expect(tagOf("review")).toBe("land");
  expect(tagOf("waiting-on-you")).toBe("land");
  expect(crewLandCommand({ id: "task-7", state: "rework" }).taskId).toBe("task-7");
});

// witness: apps/web/src/zerops/renewDeployKey.logic.ts | return mayKeep === false ? "none" : "start"; → return mayKeep !== true ? "none" : "start";
it("RV6: The renewal's press is a start for whoever HQ's keep rule admits or has not answered yet, Continue only for the maker of a renewal that waits, and none for a person the rule refuses or while another person's renewal waits; breaks: a Basic user who may renew gets no press, or a person HQ refuses gets one that fails.", () => {
  const failure = { step: "key", code: "refused", at: "now", origin: "zerops" };
  const waiting = {
    kind: "waiting",
    id: "op",
    continueBy: "maker",
    press: "Continue",
    why: "wait",
    line: "wait",
  } as const;
  const rows: ReadonlyArray<
    readonly [HqOperationStanding, boolean | undefined, "start" | "continue" | "none"]
  > = [
    [{ kind: "none" }, true, "start"],
    [{ kind: "none" }, undefined, "start"],
    [{ kind: "none" }, false, "none"],
    [{ kind: "failed", id: "op", failure }, true, "start"],
    [{ kind: "failed", id: "op", failure }, false, "none"],
    [{ kind: "going", id: "op" }, true, "start"],
    [{ kind: "needs", needs: "decision" }, true, "start"],
    [{ ...waiting, yours: true }, true, "continue"],
    [{ ...waiting, yours: true }, false, "continue"],
    [{ ...waiting, yours: true }, undefined, "continue"],
    [{ ...waiting, yours: false }, true, "none"],
  ];
  for (const [standing, mayKeep, answer] of rows)
    expect(keyRenewOffer(standing, mayKeep)).toBe(answer);
});

// witness: apps/web/src/zerops/renewDeployKey.logic.ts | if (failure.step !== "retire") return operationFailureWords(failure); → if (failure.step === "retire") return operationFailureWords(failure);
it("RV7: A renewal HQ ended at its retire step is told as a kept key whose previous token stays, with who deletes it by Zerops' code, and a stop at any other step in the operation's own words; breaks: a person whose renewal worked reads that it failed.", () => {
  const owner = { step: "retire", code: "ownerRoleRequired", at: "now", origin: "zerops" };
  const other = { ...owner, code: "other" };
  const key = { ...other, step: "key" };
  expect(keyRenewFailureWords(owner)).not.toBe(keyRenewFailureWords(other));
  expect(keyRenewFailureWords(owner)).not.toBe(operationFailureWords(owner));
  expect(keyRenewFailureWords(other)).not.toBe(operationFailureWords(other));
  expect(keyRenewFailureWords(key)).toBe(operationFailureWords(key));
});

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | runs: input.stages.filter((stage) => stage.gap === undefined).map((stage) => stage.name), → runs: input.stages.map((stage) => stage.name),
it("RV5: A change waiting on its press promises its merge only to the stages whose deploy key works, names the first stage its key holds, and offers that key's renewal to whoever HQ's rule lets renew it and tells anyone else who does; a recipe change and a change no longer waiting say nothing of keys; breaks: a person merges on \"Stage runs it\" while the stage deploys nothing, or one who may renew is sent to look for an admin.", () => {
  const a = { name: "a", gap: undefined };
  const ai = { name: "a", gap: { kind: "invalid", project: "a" } } as const;
  const am = { name: "a", gap: { kind: "missing", project: "a" } } as const;
  const b = { name: "b", gap: undefined };
  const bi = { name: "b", gap: { kind: "invalid", project: "b" } } as const;
  const rows = [
    [{ state: "ready", recipe: false, stages: [a], mayRenew: true }, ["a"], undefined, undefined],
    [{ state: "ready", recipe: false, stages: [ai], mayRenew: true }, [], "a", "renew"],
    [{ state: "ready", recipe: false, stages: [ai], mayRenew: false }, [], "a", "told"],
    [{ state: "ready", recipe: false, stages: [am], mayRenew: false }, [], "a", "told"],
    [{ state: "ready", recipe: false, stages: [ai, b], mayRenew: true }, ["b"], "a", "renew"],
    [{ state: "ready", recipe: false, stages: [ai, bi], mayRenew: true }, [], "a", "renew"],
    [
      { state: "github-checks-failed", recipe: false, stages: [ai], mayRenew: true },
      [],
      "a",
      "renew",
    ],
    [{ state: "merged", recipe: false, stages: [ai], mayRenew: true }, ["a"], undefined, undefined],
    [{ state: "ready", recipe: true, stages: [ai], mayRenew: true }, ["a"], undefined, undefined],
  ] as const;
  for (const [input, runs, held, offer] of rows) {
    const answer = mergeStages(input);
    expect(answer.runs).toEqual(runs);
    expect(answer.held?.stage.name).toBe(held);
    expect(answer.held?.offer).toBe(offer);
  }
});

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | verdict.why === "" || → verdict.why !== "" ||
it("RV12: An addition handed to a person shows its given-up reason in the review; breaks: the reason reaches the verdict but the review hides it.", () => {
  const pull: ChangeReviewInput["pull"] = {
    number: 7,
    kind: "code",
    baseBranch: "main",
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    state: "open",
    behind: false,
    ready: true,
    pullRequest: { state: "open", checks: "failing", url: "https://github.com/o/r/pull/7" },
  };
  const handed = changeMergeVerdict({
    pull: { ...pull, checksGivenUp: { reason: "no-agent" } },
    mateName: "Nova",
  }).verdict;
  expect(whySaid(handed, false) ? handed.why : undefined).toBe(
    "No agent can work on this Mate: sign one in, then ask it to fix the check.",
  );
  expect(whySaid(changeMergeVerdict({ pull, mateName: "Nova" }).verdict, false)).toBe(false);
});
