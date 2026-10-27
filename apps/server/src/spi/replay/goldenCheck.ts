// @effect-diagnostics nodeBuiltinImport:off
/**
 * Golden-file checker shared by every driver's replay test: compares an
 * already-redacted event list against the checked-in `<name>.expected.json`
 * next to its fixture, or (re)writes it when `SPI_UPDATE_GOLDENS=1` is set.
 * A rewrite needs a reason in the commit message — this module does not
 * enforce that, it can't.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export function expectedPathFor(dir: string, name: string): string {
  return NodePath.join(dir, `${name}.expected.json`);
}

export interface GoldenCheckResult {
  readonly updated: boolean;
  readonly expected: ReadonlyArray<Record<string, unknown>>;
}

export function checkOrUpdateGolden(
  dir: string,
  name: string,
  actual: ReadonlyArray<Record<string, unknown>>,
): GoldenCheckResult {
  const path = expectedPathFor(dir, name);

  if (process.env.SPI_UPDATE_GOLDENS === "1") {
    NodeFS.writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    return { updated: true, expected: actual };
  }

  if (!NodeFS.existsSync(path)) {
    throw new Error(
      `${path}: no golden file. Set SPI_UPDATE_GOLDENS=1 to create it (state why in the commit message).`,
    );
  }

  const expected = JSON.parse(NodeFS.readFileSync(path, "utf8")) as ReadonlyArray<
    Record<string, unknown>
  >;
  return { updated: false, expected };
}

/** Finds and describes the first divergence between `actual` and `expected`, or returns undefined when they match. */
export function describeFirstDivergence(
  fixtureName: string,
  actual: ReadonlyArray<Record<string, unknown>>,
  expected: ReadonlyArray<Record<string, unknown>>,
): string | undefined {
  if (actual.length !== expected.length) {
    return `${fixtureName}: event count differs — actual ${actual.length}, expected ${expected.length}`;
  }
  for (let index = 0; index < actual.length; index += 1) {
    const actualJson = JSON.stringify(actual[index]);
    const expectedJson = JSON.stringify(expected[index]);
    if (actualJson !== expectedJson) {
      const actualType = (actual[index] as { readonly type?: unknown })?.type;
      const expectedType = (expected[index] as { readonly type?: unknown })?.type;
      return `${fixtureName}: first divergence at event index ${index} (type actual=${String(actualType)} expected=${String(expectedType)})`;
    }
  }
  return undefined;
}
