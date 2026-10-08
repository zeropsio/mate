import { describe, expect, it } from "vite-plus/test";

import {
  openUserInputRequests,
  pendingUserInputQuestion,
  type UserInputLifecycleActivity,
} from "./pendingUserInput.ts";

const at = (second: number) => `2026-09-29T08:00:${String(second).padStart(2, "0")}.000Z`;

const asked = (
  second: number,
  requestId: string,
  questions: ReadonlyArray<string>,
): UserInputLifecycleActivity => ({
  activityId: `asked-${requestId}-${second}`,
  kind: "user-input.requested",
  createdAt: at(second),
  payload: {
    requestId,
    questions: questions.map((question, index) => ({
      id: `q${index}`,
      header: "Question",
      question,
      options: [],
    })),
  },
});

const answered = (second: number, requestId: string): UserInputLifecycleActivity => ({
  activityId: `answered-${requestId}-${second}`,
  kind: "user-input.resolved",
  createdAt: at(second),
  payload: { requestId, answers: {} },
});

const replyFailed = (
  second: number,
  requestId: string,
  detail: string,
): UserInputLifecycleActivity => ({
  activityId: `failed-${requestId}-${second}`,
  kind: "provider.user-input.respond.failed",
  createdAt: at(second),
  payload: { requestId, detail },
});

describe("pending user input", () => {
  it.each<{
    readonly name: string;
    readonly activities: ReadonlyArray<UserInputLifecycleActivity>;
    readonly open: number;
    readonly question: string | null;
  }>([
    { name: "nothing asked", activities: [], open: 0, question: null },
    {
      name: "a restart resolution is final even at the same timestamp before the request sorts",
      activities: [answered(1, "r1"), asked(1, "r1", ["Where?"])],
      open: 0,
      question: null,
    },
    {
      name: "a question waits: its words",
      activities: [asked(1, "r1", ["Ship the status page now, or after the review?"])],
      open: 1,
      question: "Ship the status page now, or after the review?",
    },
    {
      name: "answered: nothing waits",
      activities: [asked(1, "r1", ["Which colour?"]), answered(4, "r1")],
      open: 0,
      question: null,
    },
    {
      name: "a reply the provider no longer knows closes it",
      activities: [
        asked(1, "r1", ["Which colour?"]),
        replyFailed(4, "r1", "Stale pending user-input request r1"),
      ],
      open: 0,
      question: null,
    },
    {
      name: "a reply that failed for another reason leaves it open",
      activities: [asked(1, "r1", ["Which colour?"]), replyFailed(4, "r1", "Network timeout")],
      open: 1,
      question: "Which colour?",
    },
    {
      name: "two wait: the older one asks first, whatever order they are read in",
      activities: [
        asked(5, "r2", ["Deploy to stage too?"]),
        asked(2, "r1", ["Which colour?", "Which size?"]),
      ],
      open: 2,
      question: "Which colour?",
    },
    {
      name: "the older one answered: the newer one's question",
      activities: [
        asked(2, "r1", ["Which colour?"]),
        asked(5, "r2", ["Deploy to stage too?"]),
        answered(6, "r1"),
      ],
      open: 1,
      question: "Deploy to stage too?",
    },
    {
      name: "a request with no words to its question gives way to the next",
      activities: [asked(1, "r1", ["  "]), asked(2, "r2", ["Keep the old route?"])],
      open: 2,
      question: "Keep the old route?",
    },
    {
      name: "quoted as a preview quotes: markdown's marks dropped",
      activities: [asked(1, "r1", ["Should I **ship** `#7` to [stage](https://x.test)?"])],
      open: 1,
      question: "Should I ship #7 to stage?",
    },
  ])("$name", ({ activities, open, question }) => {
    expect(openUserInputRequests(activities)).toHaveLength(open);
    expect(pendingUserInputQuestion(activities)).toBe(question);
  });

  it("a long question is cut at a word", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    const question = pendingUserInputQuestion([asked(1, "r1", [words])]);
    expect(question?.length).toBeLessThanOrEqual(160);
    expect(words.startsWith((question ?? "").replace(/…$/u, ""))).toBe(true);
  });

  it("a credential in the question is masked", () => {
    const token = ["ghp", "abcdefghijklmnopqrstuvwxyz0123"].join("_");
    expect(pendingUserInputQuestion([asked(1, "r1", [`Use ${token} to push?`])])).not.toContain(
      token,
    );
  });
});
