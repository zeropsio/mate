import { describe, expect, it } from "vite-plus/test";

import { parseMateSetup, readMateSetup, standUpFailureWords } from "./mateSetup.ts";

const ORIGIN = "https://zcp-1a2b-8080.prg1.zerops.app";

const document = (steps: ReadonlyArray<Record<string, unknown>>, version: unknown = 1) => ({
  version,
  at: "2026-10-01T10:00:00Z",
  steps,
});

describe("parseMateSetup", () => {
  it("reads every step it knows, by id", () => {
    expect(
      parseMateSetup(
        document([
          { id: "container", state: "done", at: "" },
          { id: "git", state: "waiting", at: "" },
          { id: "runtimes", state: "running", at: "" },
          { id: "signin", state: "waiting", at: "" },
          { id: "standup", state: "waiting", at: "" },
        ]),
      ),
    ).toEqual({
      at: "2026-10-01T10:00:00Z",
      container: "done",
      git: "waiting",
      runtimes: "running",
      signin: "waiting",
      standup: "waiting",
    });
  });

  it.each([
    { case: "a step it does not know", step: { id: "coffee", state: "done" } },
    { case: "a state a step does not have", step: { id: "git", state: "running" } },
    { case: "a step with no state", step: { id: "git" } },
  ])("ignores $case, never guessing", ({ step }) => {
    expect(parseMateSetup(document([step, { id: "signin", state: "done" }]))).toEqual({
      at: "2026-10-01T10:00:00Z",
      signin: "done",
    });
  });

  it.each([
    {
      case: "no official HQ",
      step: { id: "git", state: "failed", at: "", reason: "no_hq" },
      want: { git: "failed", gitFailure: { reason: "no_hq" } },
    },
    {
      case: "HQ refused it, with its code",
      step: { id: "git", state: "failed", at: "", reason: "refused", code: "not_a_mate" },
      want: { git: "failed", gitFailure: { reason: "refused", code: "not_a_mate" } },
    },
    {
      case: "HQ refused it, with no code",
      step: { id: "git", state: "failed", at: "", reason: "refused" },
      want: { git: "failed", gitFailure: { reason: "refused" } },
    },
    {
      case: "a reason this build does not know: failed, why left unsaid",
      step: { id: "git", state: "failed", at: "", reason: "later" },
      want: { git: "failed" },
    },
  ])("reads Git access that failed, and why: $case", ({ step, want }) => {
    expect(parseMateSetup(document([step]))).toEqual({ at: "2026-10-01T10:00:00Z", ...want });
  });

  it("reads a Mate with no stand-up to run as one, never as one done", () => {
    expect(parseMateSetup(document([{ id: "standup", state: "none", at: "" }]))?.standup).toBe(
      "none",
    );
  });

  it("reads a later version's known steps the same", () => {
    expect(parseMateSetup(document([{ id: "git", state: "done", extra: 1 }], 2))?.git).toBe("done");
  });

  it.each([
    { case: "no version", body: { steps: [] } },
    { case: "no steps", body: { version: 1 } },
    { case: "a page", body: "<!doctype html>" },
    { case: "nothing", body: null },
  ])("is no setup at all for $case", ({ body }) => {
    expect(parseMateSetup(body)).toBeUndefined();
  });
});

describe("readMateSetup", () => {
  const answer = (response: Response | Error) => {
    const asked: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (url: string, init?: RequestInit) => {
      asked.push({ url, init });
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    };
    return { asked, fetchImpl };
  };

  it("asks the Mate's own route, plainly, so no preflight is sent", async () => {
    const { asked, fetchImpl } = answer(
      new Response(JSON.stringify(document([{ id: "git", state: "done" }]))),
    );
    const reading = await readMateSetup(`${ORIGIN}/`, fetchImpl);
    expect(reading).toEqual({ kind: "setup", setup: { at: "2026-10-01T10:00:00Z", git: "done" } });
    expect(asked).toEqual([{ url: `${ORIGIN}/mate/setup.json`, init: { redirect: "manual" } }]);
  });

  it.each([
    { case: "a 404: an older Mate", response: new Response("", { status: 404 }), kind: "absent" },
    {
      case: "a page in its place: an older server's catch-all",
      response: new Response("<!doctype html>", { status: 200 }),
      kind: "absent",
    },
    {
      case: "a server error: on its way up",
      response: new Response("", { status: 502 }),
      kind: "unreachable",
    },
    { case: "no answer at all", response: new TypeError("Failed to fetch"), kind: "unreachable" },
  ])("reads $case as $kind", async ({ response, kind }) => {
    const { fetchImpl } = answer(response);
    expect((await readMateSetup(ORIGIN, fetchImpl)).kind).toBe(kind);
  });
});

describe("a failed stand-up's reason", () => {
  it.each([
    { reason: "send_failed", failure: "send_failed" },
    { reason: "process_gone", failure: "process_gone" },
    { reason: "stage_not_built", failure: "stage_not_built" },
    { reason: "a_reason_this_build_does_not_know", failure: undefined },
    { reason: undefined, failure: undefined },
  ])("reads $reason as $failure", ({ reason, failure }) => {
    const setup = parseMateSetup(
      document([
        { id: "standup", state: "failed", at: "", ...(reason === undefined ? {} : { reason }) },
      ]),
    );
    expect(setup?.standup).toBe("failed");
    expect(setup?.standupFailure).toBe(failure);
  });

  it("is read only off a stand-up that failed", () => {
    expect(
      parseMateSetup(document([{ id: "standup", state: "done", at: "", reason: "process_gone" }]))
        ?.standupFailure,
    ).toBeUndefined();
  });

  it.each([
    { failure: "process_gone", words: "The stand-up's process stopped." },
    {
      failure: "stage_not_built",
      words:
        "Development is up; the previews were not built — ask the agent to build them, or deploy them by hand.",
    },
    { failure: "send_failed", words: undefined },
    { failure: undefined, words: undefined },
  ] as const)("words $failure for the person", ({ failure, words }) => {
    expect(standUpFailureWords(failure)).toBe(words);
  });
});
