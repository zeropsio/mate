import { expect, it } from "vite-plus/test";
import {
  codeStanding,
  codeStandingLine,
  codeStandingOffers,
  type CodeStanding,
} from "./codeStanding.ts";

const code = { empty: false, deletingProjectIds: [] } as const;
const setup = { empty: true, deletingProjectIds: [] } as const;

// witness: packages/client-runtime/src/zerops/codeStanding.ts | facts.contents.empty ? "setup" : "code" → facts.contents.empty ? "code" : "code"
it("ZV180: A project's standing is decided from HQ's facts in one order: a deletion of the whole project HQ runs, then anything placed in it or still being deleted, then HQ's open question, then HQ not having said what it holds, and what is left is kept, holding code or only its setup; breaks: a project whose Mates are gone reads as never started and is not listed with the code it holds", () => {
  const rows = [
    [
      { deletion: "going", placed: 0, mates: 0, contents: code, asked: false },
      { kind: "deleting", placed: false, phase: "going" },
    ],
    [
      { deletion: "failed", placed: 2, mates: 1, contents: code, asked: false },
      { kind: "deleting", placed: true, phase: "failed" },
    ],
    [
      { deletion: "waiting", placed: 0, mates: 0, contents: code, asked: false },
      { kind: "deleting", placed: false, phase: "waiting" },
    ],
    [
      { deletion: "none", placed: 1, mates: 1, contents: undefined, asked: false },
      { kind: "in-use", mate: true, leaving: false },
    ],
    [
      { deletion: "none", placed: 1, mates: 0, contents: code, asked: false },
      { kind: "in-use", mate: false, leaving: false },
    ],
    [
      {
        deletion: "none",
        placed: 0,
        mates: 0,
        contents: { empty: false, deletingProjectIds: ["p1"] },
        asked: false,
      },
      { kind: "in-use", mate: false, leaving: true },
    ],
    [
      { deletion: "none", placed: 1, mates: 1, contents: code, asked: true },
      { kind: "in-use", mate: true, leaving: false },
    ],
    [
      { deletion: "none", placed: 0, mates: 0, contents: undefined, asked: true },
      { kind: "asked" },
    ],
    [{ deletion: "none", placed: 0, mates: 0, contents: setup, asked: true }, { kind: "asked" }],
    [
      { deletion: "none", placed: 0, mates: 0, contents: undefined, asked: false },
      { kind: "unread" },
    ],
    [
      { deletion: "none", placed: 0, mates: 0, contents: code, asked: false },
      { kind: "kept", holds: "code" },
    ],
    [
      { deletion: "none", placed: 0, mates: 0, contents: setup, asked: false },
      { kind: "kept", holds: "setup" },
    ],
  ] as const;
  for (const [facts, expected] of rows) expect(codeStanding(facts)).toEqual(expected);
});

// witness: packages/client-runtime/src/zerops/codeStanding.ts | ? "owner" → ? "offered"
it("ZV181: What a project's standing offers follows HQ's word on deleting the project and the add-Mate door: a kept project offers Add a Mate as the door says and its Delete to who may delete it, says who can to who may not, and waits while HQ has not said; an asked one offers only the answer, a deletion that stopped only its review, and a project in use nothing; breaks: a kept project's code cannot be deleted where it is shown", () => {
  const viewers = [
    { deleteApp: "allowed", addMate: "offered" },
    { deleteApp: "refused", addMate: "off" },
    { deleteApp: "refused", addMate: "none" },
    { deleteApp: "unknown", addMate: "offered" },
  ] as const;
  const none = { addMate: "none", delete: "none", answer: false, review: false };
  const rows: ReadonlyArray<readonly [CodeStanding, ReadonlyArray<unknown>]> = [
    [
      { kind: "kept", holds: "code" },
      [
        { addMate: "offered", delete: "offered", answer: false, review: false },
        { addMate: "off", delete: "owner", answer: false, review: false },
        { addMate: "none", delete: "owner", answer: false, review: false },
        { addMate: "offered", delete: "waits", answer: false, review: false },
      ],
    ],
    [
      { kind: "kept", holds: "setup" },
      [
        { addMate: "offered", delete: "offered", answer: false, review: false },
        { addMate: "off", delete: "owner", answer: false, review: false },
        { addMate: "none", delete: "owner", answer: false, review: false },
        { addMate: "offered", delete: "waits", answer: false, review: false },
      ],
    ],
    [{ kind: "asked" }, viewers.map(() => ({ ...none, answer: true }))],
    [{ kind: "deleting", placed: false, phase: "going" }, viewers.map(() => none)],
    ...(["needs", "waiting", "failed"] as const).map(
      (phase) =>
        [
          { kind: "deleting" as const, placed: false, phase },
          viewers.map(() => ({ ...none, review: true })),
        ] as const,
    ),
    [{ kind: "in-use", mate: true, leaving: false }, viewers.map(() => none)],
    [{ kind: "unread" }, viewers.map(() => none)],
  ];
  for (const [standing, expected] of rows)
    viewers.forEach((viewer, index) =>
      expect(codeStandingOffers(standing, viewer)).toEqual(expected[index]),
    );
});

// witness: packages/client-runtime/src/zerops/codeStanding.ts | standing.holds === "code" ? "Code kept" : "Setup kept" → standing.holds === "code" ? "No Mate yet" : "Setup kept"
it("ZV182: A project's standing has one set of words, and says which of them stand over a row's own content; breaks: a kept project reads No Mate yet", () => {
  const rows: ReadonlyArray<
    readonly [CodeStanding, { words: string; notice: boolean } | undefined]
  > = [
    [{ kind: "unread" }, { words: "Checking what HQ holds…", notice: false }],
    [
      { kind: "in-use", mate: true, leaving: true },
      { words: "Deletion is still in progress.", notice: true },
    ],
    [
      { kind: "in-use", mate: false, leaving: false },
      { words: "No Mate yet", notice: false },
    ],
    [{ kind: "in-use", mate: true, leaving: false }, undefined],
    [{ kind: "asked" }, { words: "Keep its code?", notice: true }],
    [
      { kind: "kept", holds: "code" },
      { words: "Code kept", notice: true },
    ],
    [
      { kind: "kept", holds: "setup" },
      { words: "Setup kept", notice: true },
    ],
    [
      { kind: "deleting", placed: false, phase: "going" },
      { words: "Deleting…", notice: true },
    ],
    [
      { kind: "deleting", placed: false, phase: "failed" },
      { words: "It was not deleted", notice: true },
    ],
    [
      { kind: "deleting", placed: false, phase: "needs" },
      { words: "Deletion waits for a person", notice: true },
    ],
    [
      { kind: "deleting", placed: false, phase: "waiting" },
      { words: "Deletion waits for a person", notice: true },
    ],
  ];
  for (const [standing, expected] of rows) expect(codeStandingLine(standing)).toEqual(expected);
});
