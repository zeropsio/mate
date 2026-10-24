// @effect-diagnostics nodeBuiltinImport:off -- scans the scenario sources for wall-clock windows.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const scenarios = "apps/web/test/scenarios";

/** A numeric wait window: an option, a locator's, or a helper's default. */
const sized = /timeout: ?[0-9]|\.setTimeout\(\s*[0-9]|timeout = [1-9]/u;

/** Each line of `source` that sizes a wait to a number of milliseconds. */
function windowsIn(source: string) {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => sized.test(line));
}

it.each([
  ["a wait option", "await page.waitForSelector(row, { visible: true, timeout: 8000 });"],
  ["a locator's window", 'await page.locator("button").setTimeout(15_000).click();'],
  ["a helper's default", "export async function rowIn(page: Page, timeout = 10_000) {"],
])("a scenario wait sized by %s is reported", (_kind, line) => {
  expect(windowsIn(`const before = 1;\n${line}\n`)).toEqual([line]);
});

/**
 * Windows a scenario keeps, by file and line. Only removals: a wait ends on its predicate or at the
 * hang guard, and a case that tests a timeout drives it by the scenario clock.
 */
const ledger: ReadonlyArray<{ file: string; line: string; reason: string }> = [
  {
    file: "harness/browser.ts",
    line: "export async function menuMateRow(page: Page, name: string, timeout = 10_000) {",
    reason:
      "guesses a folded group from a row not drawn within 3 s; needs a receipt that tells folded from not yet drawn",
  },
  {
    file: "harness/browser.ts",
    line: "export async function visibleInMenu(page: Page, surface: string, name: string, timeout = 10_000) {",
    reason:
      "guesses a folded group from a row not drawn within 3 s; needs a receipt that tells folded from not yet drawn",
  },
];

it("scenario waits end on their predicate, apart from the ledgered windows", () => {
  const found = NodeFS.readdirSync(NodePath.join(root, scenarios), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => file.endsWith(".ts") && file !== "vitest.config.ts")
    .flatMap((file) =>
      windowsIn(NodeFS.readFileSync(NodePath.join(root, scenarios, file), "utf8")).map((line) => ({
        file,
        line,
      })),
    )
    .toSorted((a, b) => `${a.file}${a.line}`.localeCompare(`${b.file}${b.line}`));
  expect(
    found,
    "ASSERTION: a scenario wait ends on its predicate or at the hang guard; a stale ledger entry is deleted",
  ).toEqual(
    ledger
      .map(({ file, line }) => ({ file, line }))
      .toSorted((a, b) => `${a.file}${a.line}`.localeCompare(`${b.file}${b.line}`)),
  );
});
