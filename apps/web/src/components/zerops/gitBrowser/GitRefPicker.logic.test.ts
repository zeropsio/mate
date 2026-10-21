import { describe, expect, it } from "vite-plus/test";
import type { GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";
import { pickerSections } from "./GitRefPicker.logic";

const item = (patch: Partial<GitRefItem> & Pick<GitRefItem, "name" | "kind">): GitRefItem => ({
  ref: `refs/heads/${patch.name}`,
  sha: "b".repeat(40),
  committedAt: "2026-10-21T00:00:00.000Z",
  subject: "Subject",
  outsideMate: false,
  ...patch,
});
const changes = [
  { number: 4, title: "Checkout keeps the cart", mateProjectId: "vera" },
  { number: 5, title: "Another Mate's change", mateProjectId: "fen" },
];
const rows = (input: Parameters<typeof pickerSections>[0]) =>
  pickerSections(input).map((section) => [
    section.name,
    section.rows.map(({ label, detail, rev }) => ({ label, detail, rev })),
  ]);

describe("ref picker", () => {
  it.each([
    [
      "held change",
      item({ name: "mate/vera/4", kind: "change", change: { mateId: "vera", number: 4 } }),
      { label: "Checkout keeps the cart", detail: "mate/vera/4", rev: "mate/vera/4" },
    ],
    [
      "same number, another Mate",
      item({ name: "mate/vera/5", kind: "change", change: { mateId: "vera", number: 5 } }),
      { label: "mate/vera/5", detail: null, rev: "mate/vera/5" },
    ],
    [
      "change the page does not hold",
      item({ name: "mate/vera/9", kind: "change", change: { mateId: "vera", number: 9 } }),
      { label: "mate/vera/9", detail: null, rev: "mate/vera/9" },
    ],
  ])("The ref picker names a change's branch by the change's title: %s", (_, ref, row) => {
    expect(
      rows({ items: [item({ name: "main", kind: "branch" }), ref], query: "", changes }),
    ).toEqual([
      ["Branches", [{ label: "main", detail: null, rev: "main" }]],
      ["Changes", [row]],
    ]);
  });

  it.each([
    ["abc1234", [["Commit", [{ label: "Commit abc1234", detail: null, rev: "abc1234" }]]]],
    [
      " ABCDEF0123456789abcdef0123456789abcdef01 ",
      [
        [
          "Commit",
          [
            {
              label: "Commit abcdef0",
              detail: null,
              rev: "abcdef0123456789abcdef0123456789abcdef01",
            },
          ],
        ],
      ],
    ],
    ["abc123", []],
    ["release-1", []],
    ["abcdef0123456789abcdef0123456789abcdef012", []],
  ])("A typed commit id is offered as a commit: %j", (query, expected) => {
    expect(rows({ items: [], query, changes })).toEqual(expected);
  });

  it("A GitHub branch opens by its full name, so it never opens Mate's branch of the same name", () => {
    expect(
      rows({
        items: [
          item({
            name: "main",
            kind: "github-branch",
            ref: "refs/github/heads/main",
            outsideMate: true,
          }),
        ],
        query: "",
        changes,
      }),
    ).toEqual([["From GitHub", [{ label: "main", detail: null, rev: "refs/github/heads/main" }]]]);
  });
});
