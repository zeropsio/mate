import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_COMMITS_SHOWN,
  REVIEW_DIFF_LINES_MAX,
  REVIEW_DIFF_LINES_SHOWN,
  absoluteDescription,
  changeConflict,
  changeFileLetter,
  changeRunMessage,
  commitFold,
  crewLandCommand,
  descriptionPicture,
  focusesPrimaryLate,
  linksChange,
  diffFold,
  giteaFileUrl,
  keyStaysInReview,
  pictureFrame,
  pressesPrimary,
  releaseChangeRows,
  remarkFold,
  reviewDescription,
  reviewKindLine,
  reviewOrigin,
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

describe("descriptionPicture: a picture is read as the person only from the app's own Gitea", () => {
  const GITEA = "https://git.example.test";
  it.each([
    [
      "an attachment on its Gitea, read as the person",
      `${GITEA}/attachments/5f1c2a`,
      { kind: "gitea", url: `${GITEA}/attachments/5f1c2a` },
    ],
    [
      "an attachment by its repository's older address, read where Gitea answers other origins",
      `${GITEA}/acme/appdev/attachments/5f1c2a`,
      { kind: "gitea", url: `${GITEA}/attachments/5f1c2a` },
    ],
    [
      "an address Gitea wrote without its host",
      "/attachments/5f1c2a",
      { kind: "gitea", url: `${GITEA}/attachments/5f1c2a` },
    ],
    [
      "an address without its scheme",
      "//git.example.test/attachments/5f1c2a",
      { kind: "gitea", url: `${GITEA}/attachments/5f1c2a` },
    ],
    [
      "a file of the repository on its Gitea",
      `${GITEA}/acme/appdev/raw/commit/b21d904/docs/page.png`,
      { kind: "gitea", url: `${GITEA}/acme/appdev/raw/commit/b21d904/docs/page.png` },
    ],
    [
      "a picture anywhere else: a plain link, never read with the token",
      "https://pictures.example/cat.png",
      { kind: "elsewhere", url: "https://pictures.example/cat.png" },
    ],
    [
      "the Gitea's host over plain http: a plain link",
      "http://git.example.test/attachments/5f1c2a",
      { kind: "elsewhere", url: "http://git.example.test/attachments/5f1c2a" },
    ],
    ["an inline picture: nothing to read", "data:image/png;base64,iVBORw0KGgo=", { kind: "none" }],
    ["a script: nothing", "javascript:alert(1)", { kind: "none" }],
  ] as const)("%s", (_case, src, picture) => {
    expect(descriptionPicture(src, GITEA)).toEqual(picture);
  });

  it("reads nothing as the person with no Gitea known", () => {
    expect(descriptionPicture("/attachments/5f1c2a", undefined)).toEqual({ kind: "none" });
    expect(descriptionPicture("https://git.example.test/attachments/5f1c2a", undefined)).toEqual({
      kind: "elsewhere",
      url: "https://git.example.test/attachments/5f1c2a",
    });
  });
});

describe("absoluteDescription: what Gitea wrote without its host points at its Gitea", () => {
  const GITEA = "https://git.example.test";
  it.each([
    ["a picture", "![The page](/attachments/5f1c2a)", `![The page](${GITEA}/attachments/5f1c2a)`],
    ["a link", "See [#3](/acme/appdev/pulls/3).", `See [#3](${GITEA}/acme/appdev/pulls/3).`],
    [
      "a picture written as HTML",
      '<img src="/attachments/5f1c2a" width="640" alt="The page">',
      `<img src="${GITEA}/attachments/5f1c2a" width="640" alt="The page">`,
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
      `\`\`\`md\n![a](/attachments/1)\n\`\`\`\n![b](${GITEA}/attachments/2)`,
    ],
  ])("%s", (_case, text, written) => {
    expect(absoluteDescription(text, GITEA)).toBe(written);
  });

  it("leaves the text alone with no Gitea known", () => {
    expect(absoluteDescription("![a](/attachments/1)", undefined)).toBe("![a](/attachments/1)");
  });
});

describe("pictureFrame: a picture holds its room before its bytes come", () => {
  it.each([
    ["the shape its size attributes give", 1280, 800, "1280 / 800"],
    ["the same, written as text", "640", "480", "640 / 480"],
    ["a screenshot's shape where it gives none", undefined, undefined, "16 / 10"],
    ["a screenshot's shape where it gives one side", 640, undefined, "16 / 10"],
    ["a screenshot's shape where a side is no number", "auto", "50%", "16 / 10"],
  ] as const)("%s", (_case, width, height, ratio) => {
    expect(pictureFrame(width, height)).toBe(ratio);
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
  const link = "https://gitea.example/snap/appdev/pulls/2";
  it("keeps the run's own sentences and leaves the link to the change out", () => {
    const text = `Added a **/status** route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.\n\nPull request carrying this to main, ready for a person to merge: ${link}`;
    expect(runWords(text, "/snap/appdev/pulls/2")).toBe(
      "Added a /status route that lists the app's uptime and its last deploy, refreshed on each visit. It stays behind the sign-in, like the rest of the admin pages.",
    );
  });

  it("stops at a sentence once four lines' worth is said", () => {
    const sentence = "This sentence is exactly seventy-five characters long, give or take a few.";
    const words = runWords(Array.from({ length: 12 }, () => sentence).join(" "), "/x/y/pulls/1");
    expect(words?.length).toBeLessThanOrEqual(400);
    expect(words?.endsWith(".")).toBe(true);
  });

  it("says nothing where the run said only the link", () => {
    expect(runWords(`Opened ${link}`, "/snap/appdev/pulls/2")).toBeUndefined();
  });

  it("reads a list as sentences, not as its bullets", () => {
    expect(runWords("- Added the route.\n- Wrote a test for it.\n", "/a/b/pulls/3")).toBe(
      "Added the route. Wrote a test for it.",
    );
  });
});

describe("diffFold: a long file's diff folds, the fold opens, and past what fits it says where the rest is (D4)", () => {
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
      "one too long to show here: the rest is on Gitea",
      { total: MAX + 1, all: false, cut: false },
      {
        shown: SHOWN,
        rest: {
          kind: "gitea",
          words: `${String(MAX + 1 - SHOWN)} more lines, too many to show here.`,
        },
      },
    ],
    [
      "one the read stopped inside, short",
      { total: 40, all: false, cut: true },
      { shown: 40, rest: { kind: "gitea", words: "The rest is too long to read here." } },
    ],
    [
      "one the read stopped inside, opened",
      { total: SHOWN + 1, all: true, cut: true },
      { shown: SHOWN + 1, rest: { kind: "gitea", words: "The rest is too long to read here." } },
    ],
    [
      "one too long to show that the read stopped inside",
      { total: MAX + 1, all: false, cut: true },
      {
        shown: SHOWN,
        rest: {
          kind: "gitea",
          words: `${String(MAX + 1 - SHOWN)}+ more lines, too many to show here.`,
        },
      },
    ],
  ])("%s", (_case, input, fold) => {
    expect(diffFold(input)).toEqual(fold);
  });
});

describe("giteaFileUrl: a file's diff on Gitea, where the review cannot show it all", () => {
  it.each([
    [
      "the change's files page, at the file",
      "https://git.example.test/acme/appdev/pulls/2",
      "src/server/index.ts",
      "https://git.example.test/acme/appdev/pulls/2/files#diff-408bfb63e4d90c09d55141f33cb31d40842d79c0",
    ],
    [
      "a path with more than ASCII in it",
      "https://git.example.test/acme/appdev/pulls/2",
      "docs/café menu.md",
      "https://git.example.test/acme/appdev/pulls/2/files#diff-703f1bfa43b096a5c1ef12d5a2c86f9c593d2952",
    ],
    ["nothing where the change has no page", undefined, "src/server/index.ts", undefined],
  ])("%s", (_case, pullUrl, path, url) => {
    expect(giteaFileUrl(pullUrl, path)).toBe(url);
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
  const merged = [
    {
      number: 54,
      title: "Performance tuning across the storefront",
      mateProjectId: "p-juno",
      mergedAt: "2026-09-28T09:00:00Z",
      mergeCommitSha: "aaa111",
    },
    {
      number: 55,
      title: "Clearer copy on the admin sign-in",
      mateProjectId: "p-cleo",
      mergedAt: "2026-09-29T09:00:00Z",
      mergeCommitSha: "BBB222",
    },
  ];

  it("names each commit by the change it landed as, whose Mate, and whether stage runs it", () => {
    const rows = releaseChangeRows({
      commits: [
        { sha: "AAA111", subject: "Performance tuning across the storefront (#54)" },
        { sha: "bbb222", subject: "Clearer copy on the admin sign-in (#55)" },
        { sha: "ccc333", subject: "A person's direct fix" },
      ],
      merged,
      marks: new Map([
        ["aaa111", "on-stage"],
        ["bbb222", "deploying-on-stage"],
      ]),
    });
    expect(rows).toEqual([
      {
        key: "aaa111",
        title: "#54 Performance tuning across the storefront",
        mateProjectId: "p-juno",
        mergedAt: "2026-09-28T09:00:00Z",
        stage: "on-stage",
      },
      {
        key: "bbb222",
        title: "#55 Clearer copy on the admin sign-in",
        mateProjectId: "p-cleo",
        mergedAt: "2026-09-29T09:00:00Z",
        stage: "deploying-on-stage",
      },
      {
        key: "ccc333",
        title: "A person's direct fix",
        mateProjectId: undefined,
        mergedAt: undefined,
        stage: "none",
      },
    ]);
  });

  it.each([
    // Numbers are per repository: the recipe repo's #54 is not appdev's.
    ["a commit naming #54 that another repository's #54 landed as", "ddd444", undefined],
    ["the commit appdev's #54 landed as", "aaa111", "p-juno"],
  ])("credits by the commit a change landed as: %s", (_case, sha, mate) => {
    const [row] = releaseChangeRows({
      commits: [{ sha, subject: "Performance tuning across the storefront (#54)" }],
      merged: [
        ...merged,
        {
          number: 54,
          title: "Add a staging environment",
          mateProjectId: "p-uma",
          mergedAt: "2026-09-27T09:00:00Z",
          mergeCommitSha: "eee555",
        },
      ],
      marks: new Map(),
    });
    expect(row?.mateProjectId).toBe(mate);
  });
});

describe("changeConflict: which files main moved under a change that no longer merges", () => {
  const files = [{ filename: "src/server/index.ts" }, { filename: "src/routes/status.ts" }];
  const HEAD = "c".repeat(40);
  const routes = {
    sha: "a".repeat(40),
    subject: "Routes (#3)",
    at: "2026-09-29T07:00:00Z",
    files: ["src/server/index.ts"],
  };
  const tidy = {
    sha: "b".repeat(40),
    subject: "Tidy (#4)",
    at: "2026-09-29T08:00:00Z",
    files: ["README.md"],
  };
  // main's head, the newest of them.
  const health = {
    sha: HEAD,
    subject: "Health routes (#5)",
    at: "2026-09-29T09:40:00Z",
    files: ["src/server/index.ts"],
  };
  const oldestFirst = [routes, tidy, health];
  const newest = {
    files: ["src/server/index.ts"],
    by: { subject: "Health routes (#5)", at: "2026-09-29T09:40:00Z" },
  };
  it.each([
    [
      "names the overlap and the newest commit that made it, main's commits oldest first",
      { mergeability: "conflicting", files, mainSince: oldestFirst, head: HEAD },
      newest,
    ],
    [
      "names the same newest commit with main's commits newest first",
      { mergeability: "conflicting", files, mainSince: [health, tidy, routes], head: HEAD },
      newest,
    ],
    [
      "names no commit where main's head is not among them to tell which is newest",
      { mergeability: "conflicting", files, mainSince: oldestFirst, head: "d".repeat(40) },
      { files: ["src/server/index.ts"], by: undefined },
    ],
    [
      "says nothing for a change that merges",
      { mergeability: "mergeable", files, mainSince: oldestFirst, head: HEAD },
      undefined,
    ],
    [
      "waits for main's side",
      { mergeability: "conflicting", files, mainSince: undefined, head: HEAD },
      undefined,
    ],
    [
      "finds no overlap where main's commits named no files",
      { mergeability: "conflicting", files, mainSince: [{ sha: HEAD, subject: "x" }], head: HEAD },
      { files: [], by: undefined },
    ],
  ])("%s", (_name, input, expected) => {
    expect(changeConflict(input)).toEqual(expected);
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

describe("linksChange: a message links this change, never one whose number starts the same", () => {
  it.each([
    ["its own address", "Ready to merge: https://gitea.example/snap/appdev/pulls/5", true],
    ["its address before punctuation", "(https://gitea.example/snap/appdev/pulls/5).", true],
    ["its files page", "https://gitea.example/snap/appdev/pulls/5/files", true],
    ["#53's address", "https://gitea.example/snap/appdev/pulls/53", false],
    ["another repository's #5", "https://gitea.example/snap/api/pulls/5", false],
  ])("%s: %s", (_case, text, links) => {
    expect(linksChange(text, "/snap/appdev/pulls/5")).toBe(links);
  });

  it("picks the run that linked #5, not a newer one that linked #53", () => {
    const messages = [
      { role: "assistant", text: "Added the route. PR: https://gitea.example/snap/appdev/pulls/5" },
      { role: "user", text: "Now the footer." },
      { role: "assistant", text: "Footer done. PR: https://gitea.example/snap/appdev/pulls/53" },
    ];
    expect(changeRunMessage(messages, "/snap/appdev/pulls/5")?.text).toContain("Added the route.");
    expect(changeRunMessage(messages, "/snap/appdev/pulls/53")?.text).toContain("Footer done.");
    expect(changeRunMessage(messages, "/snap/appdev/pulls/7")).toBeUndefined();
  });
});

describe("focusesPrimaryLate: focus reaches the button once it turns safe, soon after opening", () => {
  it.each([
    [
      "safe while focus still rests on the review, just after it opened",
      { safe: true, onReview: true, sinceOpenMs: 300 },
      true,
    ],
    [
      "safe after the person moved the focus on",
      { safe: true, onReview: false, sinceOpenMs: 300 },
      false,
    ],
    ["safe only long after it opened", { safe: true, onReview: true, sinceOpenMs: 4000 }, false],
    ["not safe", { safe: false, onReview: true, sinceOpenMs: 300 }, false],
  ])("%s", (_case, input, focuses) => {
    expect(focusesPrimaryLate(input)).toBe(focuses);
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
