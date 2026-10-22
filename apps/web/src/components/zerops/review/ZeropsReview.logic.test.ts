import type { ChangeReceiptPart } from "@t3tools/shared/hqChanges";
import { releaseReview, type ReleaseOutcome } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_COMMITS_SHOWN,
  REVIEW_DIFF_LINES_MAX,
  REVIEW_DIFF_LINES_SHOWN,
  absoluteDescription,
  changeFileLetter,
  changeRunMessage,
  commitFold,
  crewLandCommand,
  descriptionPicture,
  diffFold,
  keyStaysInReview,
  pressesPrimary,
  changeReadVerdict,
  productionCode,
  releaseChangeRows,
  remarkFold,
  reviewDescription,
  descriptionHeads,
  reviewPictureBox,
  reviewKindLine,
  reviewOrigin,
  rollbackListNote,
  runWords,
  sizeWords,
  changeChecks,
  changeReceipt,
  mergeFoot,
  productionNow,
  productionNowLine,
  releaseFoot,
  releaseHeading,
  releaseLine,
  sinceWords,
  whySaid,
  productionBefore,
} from "./ZeropsReview.logic";

describe("reviewKindLine", () => {
  it.each([
    ["change", "code", "Review · change"],
    ["change", "recipe", "Review · setup change"],
    ["release", undefined, "Release"],
    ["rollback", undefined, "Roll back"],
    ["crew-task", undefined, "Crew task"],
  ] as const)("a %s (%s) says %s", (kind, pullKind, label) => {
    expect(reviewKindLine(kind, pullKind)).toBe(label);
  });
});

describe("reviewOrigin: it opens from the thing you clicked (R7)", () => {
  const popup = { left: 533, top: 64, width: 720, height: 800 };
  it.each([
    ["a row in the menu, left of the dialog", { x: 100, y: 300 }, { x: 0, y: 236 }],
    ["the composer's Review, under the dialog", { x: 900, y: 960 }, { x: 367, y: 800 }],
    ["a button inside its span", { x: 700, y: 200 }, { x: 167, y: 136 }],
    ["nothing to open from: its centre", undefined, { x: 360, y: 400 }],
  ])("%s", (_name, from, origin) => {
    expect(reviewOrigin(from, popup)).toEqual(origin);
  });
});

describe("pressesPrimary: ⌘↵ presses it when it is safe (R5)", () => {
  const key = { key: "Enter", metaKey: true, ctrlKey: false, repeat: false, inField: false };
  it.each([
    [key, true, true],
    [{ ...key, metaKey: false, ctrlKey: true }, true, true],
    [{ ...key, metaKey: false }, true, false],
    [key, false, false],
    [{ ...key, key: "k" }, true, false],
    // Held down, the key repeats: Merge must not walk on into the release it hands over to.
    [{ ...key, repeat: true }, true, false],
    // Typed in the comment box, ⌘↵ is the box's: it never merges what is being talked about.
    [{ ...key, inField: true }, true, false],
  ])("%o with safe=%s presses: %s", (event, safe, pressed) => {
    expect(pressesPrimary(event, { safe, enabled: safe })).toBe(pressed);
  });
});

describe("reviewDescription: the change's own words first, the run's when it wrote none", () => {
  it.each([
    [
      "its description, whatever the run said",
      { description: "Adds a /status page.", run: { words: "Added it.", reading: false } },
      { kind: "body", text: "Adds a /status page." },
    ],
    [
      "its description while the run is still read",
      { description: "Adds a /status page.", run: { words: undefined, reading: true } },
      { kind: "body", text: "Adds a /status page." },
    ],
    [
      "what the run said, where it wrote no description",
      { description: undefined, run: { words: "Added it.", reading: false } },
      { kind: "run", words: "Added it." },
    ],
    [
      "the room of the run's words while its conversation is read",
      { description: undefined, run: { words: undefined, reading: true } },
      { kind: "reading" },
    ],
    [
      "nothing at all where neither said anything: no empty heading",
      { description: undefined, run: { words: undefined, reading: false } },
      { kind: "none" },
    ],
  ] as const)("%s", (_case, input, shown) => {
    expect(reviewDescription(input)).toEqual(shown);
  });
});

// A run 2 follow-up: "What it does" stood as the section's label, then again as the description's
// own first heading.
describe("descriptionHeads: the description's own heading names its section once", () => {
  it.each([
    ["its own heading of the same name", "Lead.\n\n## What it does\n- Browse", true],
    ["any level, any case, a colon after it", "# what it does:\nBrowse", true],
    ["a heading of another name", "## How it's built\nNode", false],
    ["the words in a sentence, no heading", "What it does: browse teas.", false],
    ["a heading inside code", "```\n## What it does\n```", false],
  ] as const)("%s", (_case, text, heads) => {
    expect(descriptionHeads(text, "What it does")).toBe(heads);
  });
});

describe("descriptionPicture: a picture is read as the person only where it is a change's picture at the official HQ", () => {
  const HQ = "https://hq.example.test";
  const PICTURE = "/api/apps/g1/changes/appdev/2/attachments/a1b2c3";
  it.each([
    [
      "a change's picture at the official HQ, read as the person",
      `${HQ}${PICTURE}`,
      { kind: "hq", url: `${HQ}${PICTURE}` },
    ],
    ["one written without its host", PICTURE, { kind: "hq", url: `${HQ}${PICTURE}` }],
    [
      "one written without its scheme",
      `//hq.example.test${PICTURE}`,
      { kind: "hq", url: `${HQ}${PICTURE}` },
    ],
    [
      "anything else at the HQ: a plain link",
      `${HQ}/changes/g1/appdev/2`,
      { kind: "elsewhere", url: `${HQ}/changes/g1/appdev/2` },
    ],
    [
      "a picture anywhere else: a plain link, never read with the person's session",
      "https://pictures.example/cat.png",
      { kind: "elsewhere", url: "https://pictures.example/cat.png" },
    ],
    [
      "the HQ's host over plain http: a plain link",
      `http://hq.example.test${PICTURE}`,
      { kind: "elsewhere", url: `http://hq.example.test${PICTURE}` },
    ],
    ["an inline picture: nothing to read", "data:image/png;base64,iVBORw0KGgo=", { kind: "none" }],
    ["a script: nothing", "javascript:alert(1)", { kind: "none" }],
  ] as const)("%s", (_case, src, picture) => {
    expect(descriptionPicture(src, HQ)).toEqual(picture);
  });

  it("reads nothing as the person while the official HQ is not known", () => {
    expect(descriptionPicture(PICTURE, undefined)).toEqual({ kind: "none" });
    expect(descriptionPicture(`${HQ}${PICTURE}`, undefined)).toEqual({
      kind: "elsewhere",
      url: `${HQ}${PICTURE}`,
    });
  });
});

describe("reviewPictureBox: a picture holds its box from the size its description gives", () => {
  it.each([
    [
      "a screenshot at the width a description shows it",
      "720",
      "405",
      { aspectRatio: "720 / 405", width: "min(100%, 720px)" },
    ],
    ["its size as numbers", 640, 480, { aspectRatio: "640 / 480", width: "min(100%, 640px)" }],
    [
      // No picture stands taller than 560: a tall one is as narrow as that leaves it.
      "a whole tall page, capped at the height a picture stands",
      "720",
      "3000",
      { aspectRatio: "720 / 3000", width: "min(100%, 134px)" },
    ],
  ] as const)("%s", (_case, width, height, box) => {
    expect(reviewPictureBox(width, height)).toEqual(box);
  });

  it.each([
    ["no size", undefined, undefined],
    ["a width alone", "720", undefined],
    ["a zero", "0", "405"],
    ["a negative", "-720", "405"],
    ["words", "wide", "405"],
    ["a size no picture has", "90000", "405"],
  ] as const)(
    "holds no box for %s: the picture takes its room when it arrives",
    (_case, width, height) => {
      expect(reviewPictureBox(width, height)).toBeNull();
    },
  );
});

describe("absoluteDescription: what was written without its host points at the official HQ", () => {
  const HQ = "https://hq.example.test";
  it.each([
    ["a picture", "![The page](/attachments/5f1c2a)", `![The page](${HQ}/attachments/5f1c2a)`],
    ["a link", "See [#3](/changes/g1/appdev/3).", `See [#3](${HQ}/changes/g1/appdev/3).`],
    [
      "a picture written as HTML",
      '<img src="/attachments/5f1c2a" width="640" alt="The page">',
      `<img src="${HQ}/attachments/5f1c2a" width="640" alt="The page">`,
    ],
    [
      "an address that has its host",
      "![a](https://x.example/a.png)",
      "![a](https://x.example/a.png)",
    ],
    ["an address without its scheme", "![a](//x.example/a.png)", "![a](//x.example/a.png)"],
    ["a relative path", "![a](docs/a.png)", "![a](docs/a.png)"],
    [
      "nothing inside a fenced block of code",
      "```md\n![a](/attachments/1)\n```\n![b](/attachments/2)",
      `\`\`\`md\n![a](/attachments/1)\n\`\`\`\n![b](${HQ}/attachments/2)`,
    ],
  ])("%s", (_case, text, written) => {
    expect(absoluteDescription(text, HQ)).toBe(written);
  });

  it("leaves the text alone while the official HQ is not known", () => {
    expect(absoluteDescription("![a](/attachments/1)", undefined)).toBe("![a](/attachments/1)");
  });
});

describe("commitFold: a long run of commits folds after the first few, and opens (D4)", () => {
  it.each([
    ["one", 1, false, { shown: 1, rest: undefined }],
    [
      "as many as fit",
      REVIEW_COMMITS_SHOWN + 2,
      false,
      { shown: REVIEW_COMMITS_SHOWN + 2, rest: undefined },
    ],
    ["many: the first few", 19, false, { shown: REVIEW_COMMITS_SHOWN, rest: 19 }],
    ["many, opened: all of them", 19, true, { shown: 19, rest: undefined }],
    ["none", 0, false, { shown: 0, rest: undefined }],
  ] as const)("%s", (_case, total, all, fold) => {
    expect(commitFold({ total, all })).toEqual(fold);
  });
});

describe("remarkFold: the dialog, a quick look, shows the newest of a long conversation", () => {
  it.each([
    ["a page shows every comment", "page", 12, false, { hidden: 0 }],
    ["a short conversation, whole", "dialog", 4, false, { hidden: 0 }],
    ["a long one, its newest three", "dialog", 9, false, { hidden: 6 }],
    ["a long one, opened", "dialog", 9, true, { hidden: 0 }],
  ] as const)("%s", (_case, frame, total, all, fold) => {
    expect(remarkFold({ frame, total, all })).toEqual(fold);
  });
});

describe("runWords: what it does, in the Mate's words (R3)", () => {
  const link = "https://hq.example.test/changes/g1/appdev/2";
  it("keeps the run's own sentences and leaves the link to the change out", () => {
    const text = `Added a **/status** route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.\n\nThe change carrying this to main, ready for a person to merge: ${link}`;
    expect(runWords(text)).toBe(
      "Added a /status route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.",
    );
  });

  it("stops at a sentence once four lines' worth is said", () => {
    const sentence = "This sentence is exactly seventy-five characters long, give or take a few.";
    const words = runWords(Array.from({ length: 12 }, () => sentence).join(" "));
    expect(words?.length).toBeLessThanOrEqual(400);
    expect(words?.endsWith(".")).toBe(true);
  });

  it("says nothing where the run said only the link", () => {
    expect(runWords(`Opened ${link}`)).toBeUndefined();
  });

  it("reads a list as sentences, not as its bullets", () => {
    expect(runWords("- Added the route.\n- Wrote a test for it.\n")).toBe(
      "Added the route. Wrote a test for it.",
    );
  });

  it("reads a quote as its words, not as its markers", () => {
    expect(
      runWords("Added the route.\n\n> It stays behind the sign-in.\n> > Like the rest.\n"),
    ).toBe("Added the route. It stays behind the sign-in. Like the rest.");
  });

  // e2e 2026-10-03: "What it does" printed "> [!WARNING] > My earlier claim was incorrect…".
  it("says a callout's word into its first line, as the chat draws it", () => {
    expect(
      runWords(
        `Opened change #2 for review.\n\n> [!WARNING]\n> My earlier claim was incorrect: the scaling option supports this update.\n\n${link}`,
      ),
    ).toBe(
      "Opened change #2 for review. Warning: My earlier claim was incorrect: the scaling option supports this update.",
    );
  });
});

describe("diffFold: a long file's diff folds, the fold opens, and past what fits it says so (D4)", () => {
  const SHOWN = REVIEW_DIFF_LINES_SHOWN;
  const MAX = REVIEW_DIFF_LINES_MAX;
  it.each<[string, { total: number; all: boolean; cut: boolean }, ReturnType<typeof diffFold>]>([
    ["a short diff, whole", { total: 40, all: false, cut: false }, { shown: 40, rest: undefined }],
    [
      "a long one, folded",
      { total: SHOWN + 1, all: false, cut: false },
      { shown: SHOWN, rest: { kind: "show", label: `Show all ${String(SHOWN + 1)} lines` } },
    ],
    [
      "a long one, opened",
      { total: SHOWN + 1, all: true, cut: false },
      { shown: SHOWN + 1, rest: undefined },
    ],
    [
      "one too long to show here",
      { total: MAX + 1, all: false, cut: false },
      {
        shown: SHOWN,
        rest: {
          kind: "cut",
          words: `${String(MAX + 1 - SHOWN)} more lines, too many to show here.`,
        },
      },
    ],
    [
      "one the read stopped inside, short",
      { total: 40, all: false, cut: true },
      { shown: 40, rest: { kind: "cut", words: "The rest is too long to read here." } },
    ],
    [
      "one the read stopped inside, opened",
      { total: SHOWN + 1, all: true, cut: true },
      { shown: SHOWN + 1, rest: { kind: "cut", words: "The rest is too long to read here." } },
    ],
    [
      "one too long to show that the read stopped inside",
      { total: MAX + 1, all: false, cut: true },
      {
        shown: SHOWN,
        rest: {
          kind: "cut",
          words: `${String(MAX + 1 - SHOWN)}+ more lines, too many to show here.`,
        },
      },
    ],
  ])("%s", (_case, input, fold) => {
    expect(diffFold(input)).toEqual(fold);
  });
});

describe("changeFileLetter", () => {
  it.each([
    ["added", "A"],
    ["modified", "M"],
    ["changed", "M"],
    ["deleted", "D"],
    ["removed", "D"],
    ["renamed", "R"],
    ["copied", "C"],
    ["something new", "M"],
  ])("%s → %s", (status, letter) => {
    expect(changeFileLetter(status)).toBe(letter);
  });
});

describe("sizeWords", () => {
  it.each([
    [
      { files: 3, additions: 42, deletions: 3 },
      { files: "3 files", additions: "+42", deletions: "−3" },
    ],
    [
      { files: 1, additions: 2400, deletions: 0 },
      { files: "1 file", additions: "+2.4k", deletions: "−0" },
    ],
    [{ files: undefined, additions: undefined, deletions: undefined }, undefined],
  ])("%o", (size, words) => {
    expect(sizeWords(size)).toEqual(words);
  });
});

describe("releaseChangeRows: what goes out, one row per change", () => {
  const commit = (
    sha: string,
    subject: string,
    change: {
      readonly number: number;
      readonly title: string;
      readonly mateProjectId: string;
    } | null,
  ) => ({ sha, subject, authorName: "Juno", at: "2026-09-28T09:00:00Z", change });
  const RAYA = {
    number: 13,
    title: "Hide sold out switch remembered across visits",
    mateProjectId: "p-raya",
  };
  const MIRA = { number: 14, title: "Centre the shop", mateProjectId: "p-mira" };
  const moved = (repository: string, commits: ReadonlyArray<ReturnType<typeof commit>>) => ({
    repository,
    services: ["app"],
    commits,
    total: commits.length,
    truncated: false,
  });

  it("names each commit by the change HQ says it landed, which opens, whose Mate, and whether stage runs it", () => {
    const rows = releaseChangeRows({
      moved: [
        moved("appdev", [
          commit("aaa111", "Performance tuning across the storefront (#54)", {
            number: 54,
            title: "Performance tuning across the storefront (#54)",
            mateProjectId: "p-juno",
          }),
          commit("bbb222", "Clearer copy on the admin sign-in", {
            number: 55,
            title: "Clearer copy on the admin sign-in",
            mateProjectId: "p-cleo",
          }),
          commit("ccc333", "A person's direct fix", null),
        ]),
        // One commit two services take is one row.
        moved("appdev", [commit("aaa111", "Performance tuning across the storefront (#54)", null)]),
      ],
      marks: new Map([
        ["aaa111", "on-stage"],
        ["bbb222", "deploying-on-stage"],
      ]),
    });
    expect(rows).toEqual([
      {
        key: "aaa111",
        title: "Performance tuning across the storefront",
        change: { repository: "appdev", number: 54 },
        mateProjectId: "p-juno",
        mergedAt: "2026-09-28T09:00:00Z",
        stage: "on-stage",
      },
      {
        key: "bbb222",
        title: "Clearer copy on the admin sign-in",
        change: { repository: "appdev", number: 55 },
        mateProjectId: "p-cleo",
        mergedAt: "2026-09-28T09:00:00Z",
        stage: "deploying-on-stage",
      },
      {
        key: "ccc333",
        title: "A person's direct fix",
        change: undefined,
        mateProjectId: undefined,
        mergedAt: undefined,
        stage: "none",
        commit: { repository: "appdev", sha: "ccc333" },
      },
    ]);
  });

  // GitHub's merge commit and the change's own commits it brought in are all the change's (HQ's
  // comparison says so); a squash, on GitHub or in Mate, is one commit.
  it.each([
    [
      "a change merged on GitHub with a merge commit goes out once in its release",
      [
        commit("m16", "Hide sold out switch remembered across visits (#16)", RAYA),
        commit("b2", "Remember the switch", RAYA),
        commit("b1", "Add the switch", RAYA),
      ],
    ],
    [
      "a change squashed on GitHub goes out once in its release",
      [commit("s16", "Hide sold out switch remembered across visits (#16)", RAYA)],
    ],
    [
      "a change merged in Mate goes out once in its release",
      [commit("s13", "Hide sold out switch remembered across visits (#13)", RAYA)],
    ],
  ])("%s", (_, commits) => {
    const rows = releaseChangeRows({
      moved: [moved("appdev", [commit("c17", "Centre the shop", MIRA), ...commits])],
      marks: new Map(),
    });
    expect(rows.map(({ key, title, change }) => [key, title, change?.number])).toEqual([
      ["c17", "Centre the shop", 14],
      [commits[0]!.sha, "Hide sold out switch remembered across visits", 13],
    ]);
  });

  it("a release's entries name each change by its title, never HQ's number", () => {
    const rows = releaseChangeRows({
      moved: [
        moved("appdev", [
          commit("c17", "Centre the shop (#17)", { ...MIRA, title: "Centre the shop (#14)" }),
          commit("d1", "A person's fix (#3)", null),
        ]),
      ],
      marks: new Map(),
    });
    expect(rows.map(({ title }) => title)).toEqual(["Centre the shop", "A person's fix (#3)"]);
  });

  it("opens a change in the repository it was compared in: numbers are per repository", () => {
    const rows = releaseChangeRows({
      moved: [
        moved("recipe", [
          commit("eee555", "Add a staging environment", {
            number: 54,
            title: "Add a staging environment",
            mateProjectId: "p-uma",
          }),
        ]),
        moved("appdev", [
          commit("aaa111", "Performance tuning", {
            number: 54,
            title: "Performance tuning",
            mateProjectId: "p-juno",
          }),
        ]),
      ],
      marks: new Map(),
    });
    expect(rows.map(({ change, mateProjectId }) => [change, mateProjectId])).toEqual([
      [{ repository: "recipe", number: 54 }, "p-uma"],
      [{ repository: "appdev", number: 54 }, "p-juno"],
    ]);
  });
});

describe("rollbackListNote: what a roll back's list says where it lists nothing", () => {
  it.each([
    ["leaving", { state: "reading" }, "Comparing in HQ…"],
    [
      "coming-back",
      { state: "failed", reason: "HQ is not answering right now." },
      "Can't tell what comes back: HQ is not answering right now.",
    ],
    ["leaving", { state: "known" }, "Nothing leaves production."],
    ["coming-back", { state: "known" }, "Nothing comes back."],
  ] as const)("%s, %o", (side, list, words) => {
    expect(rollbackListNote(side, list)).toBe(words);
  });
});

describe("crewLandCommand: Land now takes only work never reported or sent back", () => {
  it.each([
    ["ready", "land"],
    ["review", "land"],
    ["waiting-on-you", "land"],
    ["working", "landNow"],
    ["rework", "landNow"],
  ] as const)("a %s task sends %s", (state, tag) => {
    expect(crewLandCommand({ id: "task-12", state })).toEqual({ _tag: tag, taskId: "task-12" });
  });
});

describe("changeRunMessage: the run that made a change is the newest answer linking it", () => {
  const HQ = "https://hq.example.test";
  const change = (number: number) => ({ appId: "g1", repo: "appdev", number });

  it("picks the run that linked #5, not a newer one that linked #53", () => {
    const messages = [
      { role: "assistant", text: `Added the route. Change: ${HQ}/changes/g1/appdev/5` },
      { role: "user", text: "Now the footer." },
      { role: "assistant", text: `Footer done. Change: ${HQ}/changes/g1/appdev/53` },
    ];
    expect(changeRunMessage(messages, change(5), HQ)?.text).toContain("Added the route.");
    expect(changeRunMessage(messages, change(53), HQ)?.text).toContain("Footer done.");
    expect(changeRunMessage(messages, change(7), HQ)).toBeUndefined();
  });
});

describe("keyStaysInReview: what is typed in the review acts on nothing behind it", () => {
  it.each([
    ["a digit, which picks an answer in the conversation behind", "1", true],
    ["an arrow, which moves through those answers", "ArrowDown", true],
    ["Enter, which sends one", "Enter", true],
    ["a letter, which opens a panel behind", "d", true],
    ["Page Down, which scrolls the conversation", "PageDown", true],
    ["Escape, which closes the review", "Escape", false],
  ])("%s", (_case, key, stays) => {
    expect(keyStaysInReview(key)).toBe(stays);
  });
});

describe("changeReadVerdict: a change the flow does not hold, until it is read", () => {
  const base = { repository: "apidev", number: 1 } as const;
  it.each([
    ["a read in flight", { read: { kind: "reading" } }, "busy", "Reading this change"],
    [
      "no read sent: the organization has no HQ",
      { read: { kind: "idle" }, failure: "This organization has no HQ." },
      "attention",
      "This change could not be read",
    ],
    [
      "no read sent: HQ has no public address",
      { read: { kind: "idle" }, failure: "HQ has no public address." },
      "attention",
      "This change could not be read",
    ],
    [
      "no read sent: HQ is not discovered yet",
      { read: { kind: "idle" } },
      "quiet",
      "Waiting for the organization's HQ",
    ],
    [
      "no change by that number",
      { read: { kind: "gone" } },
      "attention",
      "apidev has no change #1",
    ],
    [
      "a read that failed",
      { read: { kind: "unavailable", reason: "HQ is not answering right now." } },
      "attention",
      "This change could not be read",
    ],
    [
      "no read sent: the organization's HQ is not known yet",
      { read: { kind: "idle" } },
      "quiet",
      "Waiting for the organization's HQ",
    ],
    [
      "HQ is down before a read",
      { read: { kind: "idle" }, failure: "HQ is down." },
      "attention",
      "This change could not be read",
    ],
    [
      "HQ knows no such project",
      { read: { kind: "idle" }, projectKnown: false },
      "attention",
      "This change's project isn't known here",
    ],
  ] as const)("%s", (_case, over, tone, title) => {
    const verdict = changeReadVerdict({ ...base, ...over });
    expect({ tone: verdict.tone, title: verdict.title }).toEqual({ tone, title });
  });

  it("spins only while a read is in flight", () => {
    const kinds = ["idle", "reading", "gone"] as const;
    expect(
      kinds.map((kind) => changeReadVerdict({ ...base, read: { kind } }).tone === "busy"),
    ).toEqual([false, true, false]);
  });
});

describe("the sheet's line under a change's title", () => {
  const check = (state: "passed" | "failed" | "running" | "unknown") => ({ state });
  it.each([
    ["every check passed", "ready", [check("passed"), check("passed")], "checks passed"],
    ["one still runs", "ready", [check("passed"), check("running")], "checks running"],
    ["one failed, advisory", "ready", [check("failed"), check("passed")], "checks failed"],
    ["behind main, its checks passed", "behind-clean", [check("passed")], "checks passed"],
    ["no checks at all", "ready", [], undefined],
    ["checks nobody read for this head", "ready", [check("unknown")], undefined],
    ["merged: its checks are history", "merged", [check("passed")], undefined],
    ["refused: the refusal is the news", "merge-refused", [check("passed")], undefined],
  ] as const)("says %s", (_case, state, checks, words) => {
    expect(changeChecks({ state, checks })?.words).toBe(words);
  });

  it.each([
    ["a change ready to merge says no more than that", "ready", false, false],
    ["a draft says why", "ready", true, true],
    ["a conflict says why", "conflict", false, true],
    ["a merge says where it went", "merged", false, true],
    ["a release ready to go says no more than its line", "release-ready", false, false],
    ["a release on its way says how far", "releasing", false, true],
  ] as const)("%s", (_case, state, draft, said) => {
    expect(
      whySaid(
        { state, tone: "quiet", title: "", why: "No conflicts with main", fix: undefined },
        draft,
      ),
    ).toBe(said);
  });
});

describe("the sheet's footnote: what happens next", () => {
  it.each([
    [
      "a change ready to merge, with a stage and a production",
      { state: "ready", stage: "stage", live: "v2.3.1" },
      "Merging puts it on stage. Production keeps v2.3.1 until you release.",
    ],
    [
      "nothing released yet",
      { state: "ready", stage: "stage", live: undefined },
      "Merging puts it on stage.",
    ],
    [
      "behind main but clean",
      { state: "behind-clean", stage: "staging", live: "v1.0.0" },
      "Merging puts it on staging. Production keeps v1.0.0 until you release.",
    ],
    [
      "no stage: the review's own words",
      { state: "ready", stage: undefined, live: "v1" },
      "Adds this change to main.",
    ],
    [
      "merged: the review's own words",
      { state: "merged", stage: "stage", live: "v1" },
      "Adds this change to main.",
    ],
  ] as const)("%s", (_case, input, words) => {
    expect(mergeFoot({ ...input, consequence: "Adds this change to main." })).toBe(words);
  });

  it.each([
    [
      "a release ready to go",
      { state: "release-ready", live: "v2.3.1" },
      "It takes a minute or two. You can roll back to v2.3.1 from production's panel.",
    ],
    ["the first release", { state: "release-ready", live: undefined }, "It takes a minute or two."],
    [
      "a release on its way: the review's own words",
      { state: "releasing", live: "v1" },
      "Follows.",
    ],
  ] as const)("%s", (_case, input, words) => {
    expect(releaseFoot({ ...input, consequence: "Follows." })).toBe(words);
  });
});

describe("the release sheet's lines", () => {
  it.each([
    [
      "every change on the stage",
      { changes: 4, stage: "stage", since: "14:10", onStage: { total: 4, running: 4 } },
      "4 changes, on stage since 14:10.",
    ],
    [
      "one change, the stage's time unknown",
      { changes: 1, stage: "stage", since: undefined, onStage: { total: 1, running: 1 } },
      "1 change, on stage.",
    ],
    [
      "some not on the stage yet",
      { changes: 3, stage: "stage", since: "14:10", onStage: { total: 3, running: 1 } },
      "3 changes, 1 of them on stage so far.",
    ],
    [
      "no stage: since the release production runs",
      { changes: 2, stage: undefined, since: undefined, onStage: undefined, live: "v0.1.4" },
      "2 changes since v0.1.4.",
    ],
    [
      "no stage, nothing released",
      { changes: 2, stage: undefined, since: undefined, onStage: undefined },
      "2 changes, the first release.",
    ],
    // The onboarding run: "0 changes" for 0.4 s, then "1 change".
    [
      "no count while what goes out is still compared",
      { changes: undefined, stage: "stage", since: undefined, onStage: undefined },
      "The first release.",
    ],
    [
      "no count while compared, after a release",
      {
        changes: undefined,
        stage: undefined,
        since: undefined,
        onStage: undefined,
        live: "v0.1.4",
      },
      "Since v0.1.4.",
    ],
  ] as const)("says %s", (_case, input, words) => {
    expect(releaseLine({ live: undefined, ...input })).toBe(words);
  });

  it.each([
    [
      "what runs, since when and where",
      { live: "v2.3.1", since: "Tue", host: "shop.acme.com" },
      "Runs v2.3.1 since Tue at shop.acme.com.",
    ],
    ["what runs alone", { live: "v2.3.1", since: undefined, host: undefined }, "Runs v2.3.1."],
    [
      "nothing released",
      { live: undefined, since: undefined, host: "shop.acme.com" },
      "Nothing released yet.",
    ],
  ] as const)("says %s of production", (_case, input, words) => {
    expect(productionNowLine(input)).toBe(words);
  });

  describe("Release review has one row per part", () => {
    const web = { service: "web", url: "https://web-1.prg1.zerops.app" };
    const api = { service: "api", url: "https://api-1.prg1.zerops.app/" };
    it.each([
      {
        name: "A one-part release review shows its address when it is the only one",
        parts: [{ hostname: "app", version: "v2.3.1" }],
        addresses: [{ service: "app", url: "https://shop.acme.com" }],
        expected: { line: "Runs v2.3.1 since Tue at shop.acme.com.", rows: [] },
      },
      {
        name: "three parts: each its version and its own address, none named for the whole",
        parts: [
          { hostname: "api", version: "v2.3.0" },
          { hostname: "web", version: "v2.3.1" },
          { hostname: "worker", version: undefined },
        ],
        addresses: [web, api],
        expected: {
          line: "Runs v2.3.1 since Tue.",
          rows: [
            "api · v2.3.0 · api-1.prg1.zerops.app",
            "web · v2.3.1 · web-1.prg1.zerops.app",
            "worker · runs nothing",
          ],
        },
      },
    ])("$name", ({ parts, addresses, expected }) => {
      expect(productionNow({ live: "v2.3.1", since: "Tue", parts, addresses })).toEqual(expected);
    });
  });

  describe("Production now is what ran as the release was offered", () => {
    const releases = [
      { tag: "v0.1.1", taggedAt: "2026-10-16T19:44:40Z", entries: [{ service: "app" }] },
      { tag: "v0.1.0", taggedAt: "2026-10-16T09:16:00Z", entries: [{ service: "app" }] },
    ];
    const services = [
      { hostname: "app", appVersionName: "v0.1.0 4be1c0d" },
      { hostname: "db", appVersionName: undefined },
    ];
    it.each([
      {
        name: "Production now says when the release it replaces went live, never a newer one's time",
        input: { replaces: { kind: "release", tag: "v0.1.0" }, releasing: false },
        expected: { at: "2026-10-16T09:16:00Z", parts: [{ hostname: "app", version: "v0.1.0" }] },
      },
      {
        name: "Production now names only the parts a release puts something on: a database runs none",
        input: { replaces: { kind: "unnamed" }, releasing: false },
        expected: { at: undefined, parts: [{ hostname: "app", version: "v0.1.0" }] },
      },
      {
        name: "while a release goes out, a part it redeploys still runs the release it replaces",
        input: {
          replaces: { kind: "release", tag: "v0.1.0" },
          releasing: true,
          services: [{ hostname: "app", appVersionName: undefined }],
        },
        expected: { at: "2026-10-16T09:16:00Z", parts: [{ hostname: "app", version: "v0.1.0" }] },
      },
    ] as const)("$name", ({ input, expected }) => {
      expect(productionBefore({ releases, services, ...input })).toEqual(expected);
    });
  });

  const now = new Date(2026, 9, 10, 16, 0).getTime();
  it.each([
    ["today, by the clock", new Date(2026, 9, 10, 14, 10), "14:10"],
    ["this week, by the day", new Date(2026, 9, 6, 9, 0), "Tue"],
    ["longer ago, by the date", new Date(2026, 8, 18, 9, 0), "Sep 18"],
  ])("says when: %s", (_case, at, words) => {
    expect(sinceWords(at.toISOString(), now)).toBe(words);
  });
  it("says nothing of a time it cannot read", () => {
    expect(sinceWords("never", now)).toBeUndefined();
    expect(sinceWords(undefined, now)).toBeUndefined();
  });
});

describe("a change's receipt: each part's preview", () => {
  const HEAD = "d4e5f60718293a4b5c6d7e8f9012345678a1b2c3";
  const OLDER = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const part = (setup: string, more: Partial<ChangeReceiptPart> = {}): ChangeReceiptPart => ({
    setup,
    previewHostname: `${setup}stage`,
    deploy: "ok",
    deployedAt: "2026-10-14T21:06:00Z",
    workspaceClean: true,
    deployedCommit: HEAD,
    verified: true,
    ...more,
  });
  const noCommit = ({ deployedCommit: _commit, ...rest }: ChangeReceiptPart): ChangeReceiptPart =>
    rest;
  const receipt = (...parts: ReadonlyArray<ChangeReceiptPart>) => ({
    at: "2026-10-14T21:10:00Z",
    parts,
  });

  it("A one-part app shows no part name, no part count and no receipt", () => {
    expect(changeReceipt({ receipt: undefined, head: HEAD })).toBeUndefined();
    expect(changeReceipt({ receipt: receipt(part("app")), head: HEAD })).toBeUndefined();
  });

  it("A change's receipt lists each part's preview as from a commit, from an uncommitted tree, failed or not deployed", () => {
    const said = changeReceipt({
      receipt: receipt(
        part("web"),
        noCommit(part("api", { workspaceClean: false })),
        noCommit(part("worker", { deploy: "failed", verified: false })),
        noCommit(part("cron", { deploy: "none", verified: false })),
      ),
      head: HEAD,
    });
    expect(said?.parts.map((row) => [row.setup, row.preview, row.words])).toEqual([
      ["web", "webstage", "from d4e5f60 · verified"],
      ["api", "apistage", "from an uncommitted tree · verified"],
      ["worker", "workerstage", "deploy failed"],
      ["cron", "cronstage", "not deployed"],
    ]);
  });

  it("A receipt names a commit only for a deploy made with a clean workspace", () => {
    const said = changeReceipt({
      receipt: receipt(part("web"), part("api", { workspaceClean: false })),
      head: HEAD,
    });
    expect(said?.parts.map((row) => row.words)).toEqual([
      "from d4e5f60 · verified",
      "from an uncommitted tree · verified",
    ]);
  });

  it("When the change head moved after a preview, the receipt shows both commits", () => {
    const said = changeReceipt({
      receipt: receipt(part("web", { deployedCommit: OLDER }), part("api")),
      head: HEAD,
    });
    expect(said?.parts.map((row) => row.words)).toEqual([
      "from a1b2c3d, the change is at d4e5f60 · verified",
      "from d4e5f60 · verified",
    ]);
  });

  it("Merge warns on a stale, uncommitted or failed preview and never blocks", () => {
    const gaps = changeReceipt({
      receipt: receipt(
        part("web", { deployedCommit: OLDER }),
        part("api", { workspaceClean: false }),
        part("worker", { deploy: "failed", verified: false }),
        part("auth", { verified: false }),
        part("cron", { deploy: "none", verified: false }),
        part("docs"),
      ),
      head: HEAD,
    });
    expect(gaps?.warning).toBe(
      "Not tried at this change: web (older commit), api (uncommitted), worker (failed), auth (not verified).",
    );
    expect(
      mergeFoot({
        state: "ready",
        consequence: "Adds this change to main.",
        stage: "stage",
        live: undefined,
        warning: gaps?.warning,
      }),
    ).toBe(
      "Not tried at this change: web (older commit), api (uncommitted), worker (failed), auth (not verified). Merging puts it on stage.",
    );
    const tried = changeReceipt({ receipt: receipt(part("web"), part("api")), head: HEAD });
    expect(tried?.warning).toBeUndefined();
  });
});

describe("releaseHeading: a release's head says where it stands once", () => {
  const NOW = Date.parse("2026-10-19T10:30:00Z");
  const heading = (outcome: ReleaseOutcome) => {
    const model = releaseReview({
      tag: "v0.1.4",
      gate: { allowed: true },
      permission: { allowed: true },
      changes: 1,
      onStage: { total: 1, running: 1 },
      services: ["app"],
      replaces: { kind: "release", tag: "v0.1.3" },
      outcome,
      productionMoved: outcome.kind === "failed" ? false : undefined,
      now: NOW,
    });
    return releaseHeading({
      tag: "v0.1.4",
      model,
      line: "1 change, on stage since 10:19.",
      live: "v0.1.3",
    });
  };

  it("a running release says once that it is releasing, with its step and clock", () => {
    expect(
      heading({ kind: "releasing", progress: "Putting v0.1.4 live · 8s", clock: "8s" }),
    ).toEqual({
      title: "Releasing v0.1.4 to production",
      meta: undefined,
      state: "Putting v0.1.4 live · 8s",
      note: "You can close this. Production's line on the project's card follows it.",
      foot: "",
    });
  });

  it("a released one says it is live, and the way back", () => {
    expect(heading({ kind: "released", at: "2026-10-19T10:27:00Z" })).toEqual({
      title: "v0.1.4 is live",
      meta: undefined,
      state: "Production runs it · released 3 minutes ago",
      note: "Roll back to v0.1.3 from production's menu. It gets its own review.",
      foot: "",
    });
  });

  it("a failed one says its cause, its fix beside it", () => {
    expect(
      heading({ kind: "failed", detail: "The deploy of app failed", services: ["app"] }),
    ).toEqual({
      title: "v0.1.4 didn't go out",
      meta: undefined,
      state: undefined,
      note: "The deploy of app failed.",
      foot: "",
    });
  });

  it("an offered one says what goes out, and under its button what pressing does", () => {
    expect(heading({ kind: "offered" })).toEqual({
      title: "Release v0.1.4 to production",
      meta: "1 change, on stage since 10:19.",
      state: undefined,
      note: undefined,
      foot: "It takes a minute or two. You can roll back to v0.1.3 from production's panel.",
    });
  });
});

describe("productionCode: the code production runs, to browse before a release replaces it", () => {
  const repositories = new Map([
    ["app", "app"],
    ["api", "api"],
  ]);
  it.each([
    [
      "each service running a whole commit, by name",
      new Map([
        ["app", { kind: "commit", sha: "a1" }],
        ["api", { kind: "commit", sha: "b2" }],
      ] as const),
      repositories,
      [
        { service: "api", repository: "api", sha: "b2" },
        { service: "app", repository: "app", sha: "a1" },
      ],
    ],
    [
      "a service running nothing, or what no commit names, has none",
      new Map([
        ["app", { kind: "nothing" }],
        ["api", { kind: "untold" }],
      ] as const),
      repositories,
      [],
    ],
    [
      "a service building from no known repository has none",
      new Map([["worker", { kind: "commit", sha: "c3" }]] as const),
      repositories,
      [],
    ],
    // `useProjectFlows` never compares a production the grant withholds: its runs stay unknown.
    ["a production the grant withholds names no commit", undefined, repositories, []],
    ["nothing while its repositories are not known", new Map(), undefined, []],
  ])("%s", (_, runs, repos, expected) => {
    expect(productionCode({ runs, repositories: repos })).toEqual(expected);
  });
});
