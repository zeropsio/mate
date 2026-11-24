import { expect, it } from "vite-plus/test";
import { keyRenewOffer } from "../../../zerops/renewDeployKey.logic.ts";
import type { HqOperationStanding } from "@t3tools/client-runtime/data";
import {
  changeFixOptions,
  crewLandCommand,
  descriptionPicture,
  releaseChangeRows,
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
it("RV+2: The renewal's press is a start for whoever HQ's keep rule admits or has not answered yet, Continue only for the maker of a renewal that waits, and none for a person the rule refuses or while another person's renewal waits; breaks: a Basic user who may renew gets no press, or a person HQ refuses gets one that fails.", () => {
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
    [{ kind: "failed", failure }, true, "start"],
    [{ kind: "failed", failure }, false, "none"],
    [{ kind: "going" }, true, "start"],
    [{ kind: "needs", needs: "decision" }, true, "start"],
    [{ ...waiting, yours: true }, true, "continue"],
    [{ ...waiting, yours: true }, false, "continue"],
    [{ ...waiting, yours: true }, undefined, "continue"],
    [{ ...waiting, yours: false }, true, "none"],
  ];
  for (const [standing, mayKeep, answer] of rows)
    expect(keyRenewOffer(standing, mayKeep)).toBe(answer);
});
