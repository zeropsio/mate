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
  releaseChangeRows,
  remarkFold,
  reviewDescription,
  reviewPictureBox,
  reviewKindLine,
  reviewOrigin,
  rollbackListNote,
  runWords,
  sizeWords,
} from "./ZeropsReview.logic";

describe("reviewKindLine", () => {
  it.each([
    ["change", "code", "Review · change"],
    ["change", "recipe", "Review · recipe change"],
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
        title: "#54 Performance tuning across the storefront",
        change: { repository: "appdev", number: 54 },
        mateProjectId: "p-juno",
        mergedAt: "2026-09-28T09:00:00Z",
        stage: "on-stage",
      },
      {
        key: "bbb222",
        title: "#55 Clearer copy on the admin sign-in",
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
      },
    ]);
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
