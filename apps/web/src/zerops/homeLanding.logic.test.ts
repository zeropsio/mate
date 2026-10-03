import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { homeView, readHomeLanding, writeHomeLanding } from "./homeLanding.logic";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("homeView: the home never stands blank while it waits", () => {
  const base = {
    landing: "unknown",
    startFailed: false,
    targeted: false,
    remembered: null,
    projectsRead: false,
  } as const;
  it.each([
    ["landing unknown, nothing remembered: the wait line", {}, { kind: "wait" }],
    [
      "landing unknown, the Mate it landed on last remembered: its opening stage",
      { remembered: ref },
      { kind: "opening", ref },
    ],
    [
      "a connect hands over another environment: never the remembered Mate",
      { remembered: ref, targeted: true },
      { kind: "wait" },
    ],
    [
      "landing known, on its way there: what it waited with stays",
      { landing: "going", remembered: ref },
      { kind: "opening", ref },
    ],
    ["landing known, on its way, nothing remembered", { landing: "going" }, { kind: "wait" }],
    // "No projects" is an answer: never before the read is whole.
    ["no landing, the projects not read yet", { landing: "none" }, { kind: "wait" }],
    [
      "no landing, the projects not read yet, a Mate remembered",
      { landing: "none", remembered: ref },
      { kind: "opening", ref },
    ],
    [
      "no landing, the projects read whole: the hero",
      { landing: "none", projectsRead: true, remembered: ref },
      { kind: "hero" },
    ],
    [
      "the draft would not start",
      { landing: "going", startFailed: true, remembered: ref },
      { kind: "start-failed" },
    ],
  ] as const)("%s", (_case, over, view) => {
    expect(homeView({ ...base, ...over })).toEqual(view);
  });
});

describe("the home's landing as remembered", () => {
  it.each([
    ["a landing written", writeHomeLanding(ref), ref],
    ["nothing written", null, null],
    ["not JSON", "{", null],
    ["another shape", JSON.stringify({ environmentId: 3 }), null],
  ] as const)("%s", (_case, text, read) => {
    expect(readHomeLanding(text)).toEqual(read);
  });
});
