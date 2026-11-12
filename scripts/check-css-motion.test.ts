import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CSS_KIND, cssDeclarationFingerprint } from "@t3tools/oxlint-plugin-t3code/exceptions";

import { checkCssMotion, scanCssFramePerTick, scanCssMotion } from "./check-css-motion.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const sourceWithAnimation = ({
  declaration = "--animate-x: x 2s infinite;",
  timing = "steps(6)",
}: {
  readonly declaration?: string;
  readonly timing?: string;
} = {}) => `
  @theme inline {
    ${declaration}
  }

  @keyframes x {
    0% {
      opacity: 0;
      animation-timing-function: ${timing};
    }
    100% { opacity: 1; }
  }
`;

describe("CSS motion scanner", () => {
  it("allows a slow, capped stepped custom animation", () => {
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", sourceWithAnimation()), []);
  });

  it.each([
    ["steps above the cap", sourceWithAnimation({ timing: "steps(120)" })],
    ["continuous timing", sourceWithAnimation({ timing: "linear" })],
    [
      "a duration below one second",
      sourceWithAnimation({ declaration: "--animate-x: x 500ms infinite;" }),
    ],
  ])("reports %s", (_name, source) => {
    expect(scanCssMotion("apps/web/src/fixture.css", source)).toHaveLength(1);
  });

  it("allows a stepped longhand animation with explicit linear shorthand timing", () => {
    const source = sourceWithAnimation({ declaration: "animation: x 10s linear infinite;" });
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("validates every animation in a comma-separated shorthand", () => {
    const source = `
      .indicator { animation: a 1s 2, b 2s infinite; }
      @keyframes a {
        0% { opacity: 0; animation-timing-function: steps(2); }
        100% { opacity: 1; }
      }
      @keyframes b {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `;
    const findings = scanCssMotion("apps/web/src/fixture.css", source);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /"b"/u);
  });

  it("rejects an unstepped intermediate stop", () => {
    const source = `
      .indicator { animation: g 10s linear infinite; }
      @keyframes g {
        0% { opacity: 0; animation-timing-function: steps(2); }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `;
    const findings = scanCssMotion("apps/web/src/fixture.css", source);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /50%/u);
  });

  it("uses the shorthand timing for stops without their own timing", () => {
    const source = `
      .indicator { animation: x 2s steps(4) infinite; }
      @keyframes x {
        0% { opacity: 0; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `;
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("reports an implicit first interval with continuous timing", () => {
    const source = `
      .indicator { animation: x 2s ease infinite; }
      @keyframes x {
        to { opacity: 0; }
      }
    `;
    const findings = scanCssMotion("apps/web/src/fixture.css", source);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /0%→100%/u);
  });

  it("allows an implicit first interval with stepped shorthand timing", () => {
    const source = `
      .indicator { animation: y 2s steps(4) infinite; }
      @keyframes y {
        to { opacity: 0; }
      }
    `;
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("checks the last authored stop against an implicit final stop", () => {
    const source = `
      .indicator { animation: x 2s ease infinite; }
      @keyframes x {
        0% { opacity: 0; animation-timing-function: steps(4); }
        50% { opacity: 0.5; }
      }
    `;
    const findings = scanCssMotion("apps/web/src/fixture.css", source);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /50%→100%/u);
  });

  it("uses a sibling timing function when the shorthand omits one", () => {
    const source = `
      .indicator {
        animation: x 2s infinite;
        animation-timing-function: steps(4);
      }
      @keyframes x {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `;
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("uses a sibling timing-function list for longhand animations", () => {
    const source = `
      .indicator {
        animation-name: x;
        animation-duration: 2s;
        animation-iteration-count: INFINITE;
        animation-timing-function: steps(4);
      }
      @keyframes x {
        0% { opacity: 0; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `;
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("resolves animation-name and animation-duration beside an infinite iteration count", () => {
    const source = sourceWithAnimation({
      declaration: `
        animation-name: x;
        animation-duration: 2s;
        animation-iteration-count: infinite;
      `,
    });
    assert.deepStrictEqual(scanCssMotion("apps/web/src/fixture.css", source), []);
  });

  it("does not exempt a fast infinite animation in reduced-motion media", () => {
    const source = `
      @media (prefers-reduced-motion: reduce) {
        .indicator { animation: x 500ms steps(4) infinite; }
      }
      @keyframes x {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `;
    expect(scanCssMotion("apps/web/src/fixture.css", source)).toHaveLength(1);
  });

  it("names a missing keyframe in the finding detail", () => {
    const findings = scanCssMotion(
      "apps/web/src/fixture.css",
      ".indicator { animation: missing 2s infinite; }",
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /missing/u);
  });

  it("skips generated CSS headers", () => {
    const source = `
      /* Generated by scripts/fixture.ts. Do not edit manually. */
      .indicator { animation: missing 2s infinite; }
    `;
    assert.deepStrictEqual(scanCssMotion("apps/mobile/generated-fixture.css", source), []);
  });
});

describe("CSS frame-per-tick scanner", () => {
  const scan = (source: string) => scanCssFramePerTick("apps/web/src/fixture.css", source);

  // witness: scripts/check-css-motion.ts | declaration.property === "content-visibility" && → declaration.property === "contain" &&
  it("reports a box with content-visibility: auto", () => {
    const findings = scan(".row { content-visibility: auto; contain-intrinsic-size: auto 96px; }");
    assert.equal(findings.length, 1);
    assert.equal(
      findings[0]!.fingerprint,
      cssDeclarationFingerprint({
        selector: ".row",
        property: "content-visibility",
        value: "auto",
      }),
    );
  });

  // witness: scripts/check-css-motion.ts | /^auto(?:\s*!important)?$/iu.test(declaration.value) → /^(?:auto|hidden)(?:\s*!important)?$/iu.test(declaration.value)
  it("allows content-visibility: hidden and visible", () => {
    assert.deepStrictEqual(
      scan(".kept { content-visibility: hidden; } .shown { content-visibility: visible; }"),
      [],
    );
  });

  // witness: scripts/check-css-motion.ts | "backdrop-filter", → "backdrop-filter", "background-position",
  it("reports an infinite animation of a property the compositor cannot run", () => {
    const findings = scan(`
      .frame { animation: slide 10s linear infinite; }
      @keyframes slide {
        0% { background-position: 0% 50%; }
        100% { background-position: 200% 50%; }
      }
    `);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /"slide" animates background-position/u);
  });

  // witness: scripts/check-css-motion.ts | .toSorted(); → ;
  it("names every such property of an animation that also moves a composited one", () => {
    const findings = scan(`
      .bar { animation-name: grow; animation-duration: 2s; animation-iteration-count: infinite; }
      @keyframes grow {
        from { transform: scaleX(0); width: 0; }
        to { transform: scaleX(1); width: 100%; color: red; }
      }
    `);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /animates color, width:/u);
  });

  // witness: scripts/check-css-motion.ts | if (!isAnimation) continue; → if (!TARGET_PROPERTIES.has(declaration.property)) continue;
  it("reports an infinite theme animation of a custom property", () => {
    const findings = scan(`
      @theme inline { --animate-glow: glow 3s infinite; }
      @keyframes glow {
        0% { --glow: 0; }
        100% { --glow: 1; }
      }
    `);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /--glow/u);
  });

  // witness: scripts/check-css-motion.ts | "filter", →
  it("allows an infinite animation the compositor runs alone", () => {
    assert.deepStrictEqual(
      scan(`
        .spinner { animation: turn 1s linear infinite; }
        .pulse { animation: breathe 2s ease-in-out infinite; }
        .drift { animation: drift 4s linear infinite; }
        @keyframes turn { to { transform: rotate(360deg); } }
        @keyframes breathe {
          0% { opacity: 1; animation-timing-function: ease-in; }
          50% { opacity: 0.4; filter: blur(1px); }
        }
        @keyframes drift { to { translate: 10px 0; rotate: 4deg; scale: 1.1; } }
      `),
      [],
    );
  });

  // witness: scripts/check-css-motion.ts | const runsForever = (value: string): boolean => INFINITE_TOKEN_PATTERN.test(value); → const runsForever = (value: string): boolean => value.length > 0;
  it("allows an animation that ends, whatever it animates", () => {
    assert.deepStrictEqual(
      scan(`
        .open { animation: unfold 200ms ease-out; }
        .thrice { animation: unfold 200ms 3; }
        @keyframes unfold { from { height: 0; } to { height: 40px; } }
      `),
      [],
    );
  });

  // witness: scripts/check-css-motion.ts | const runsForever = (value: string): boolean => INFINITE_TOKEN_PATTERN.test(value); → const runsForever = (value: string): boolean => value.length > 0;
  it("checks only the infinite animation of a comma-separated shorthand", () => {
    const findings = scan(`
      .mixed { animation: unfold 200ms 1, sweep 2s infinite; }
      @keyframes unfold { from { height: 0; } to { height: 40px; } }
      @keyframes sweep { to { left: 100%; } }
    `);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.detail, /"sweep" animates left/u);
  });

  // witness: scripts/check-css-motion.ts | if (resolved === undefined) continue; → if (resolved === undefined) { finding("no keyframes"); continue; }
  it("leaves an animation with no keyframes to the motion scanner", () => {
    assert.deepStrictEqual(scan(".indicator { animation: missing 2s infinite; }"), []);
  });

  // witness: scripts/check-css-motion.ts | const blocks = isGeneratedCssSource(source) ? [] : walkBlocks(parseCssBlocks(source)); → const blocks = walkBlocks(parseCssBlocks(source));
  it("skips generated CSS headers", () => {
    assert.deepStrictEqual(
      scanCssFramePerTick(
        "apps/mobile/generated-fixture.css",
        `
          /* Generated by scripts/fixture.ts. Do not edit manually. */
          .row { content-visibility: auto; }
        `,
      ),
      [],
    );
  });
});

it.layer(NodeServices.layer)("CSS motion ledger reconciliation", (it) => {
  // witness: scripts/check-css-motion.ts | [FRAME_RULE_NAME, scanCssFramePerTick], →
  it.effect("fails for an unlisted frame-per-tick finding while accepting a ledgered one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "css-frame-ledger-" });
        const ledgeredPath = "apps/web/src/ledgered.css";
        const source = ".row { content-visibility: auto; }";
        yield* fs.writeFileString(
          path.join(directory, "no-frame-per-tick.json"),
          `${encodeUnknownJson([
            {
              path: ledgeredPath,
              kind: CSS_KIND,
              fingerprint: cssDeclarationFingerprint({
                selector: ".row",
                property: "content-visibility",
                value: "auto",
              }),
              owner: "fixture-owner",
              reason: "Fixture exception",
              expires: "never",
            },
          ])}\n`,
        );

        const accepted = yield* checkCssMotion({
          directory,
          sources: [{ path: ledgeredPath, source }],
        });
        assert.equal(accepted.exitCode, 0);
        assert.match(accepted.report, /no-frame-per-tick: ledger reconciled \(1 entries\)/u);

        const result = yield* checkCssMotion({
          directory,
          sources: [
            { path: ledgeredPath, source },
            { path: "apps/web/src/unlisted.css", source },
          ],
        });
        assert.equal(result.exitCode, 1);
        assert.equal(result.problemCount, 1);
        assert.match(
          result.report,
          /no-frame-per-tick: unlisted apps\/web\/src\/unlisted\.css:css-declaration/u,
        );
      }),
    ),
  );

  it.effect("fails for one unlisted finding while accepting one ledgered finding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "css-motion-ledger-" });
        const ledgeredPath = "apps/web/src/ledgered.css";
        const source = ".indicator { animation: missing 2s infinite; }";
        const fingerprint = cssDeclarationFingerprint({
          selector: ".indicator",
          property: "animation",
          value: "missing 2s infinite",
        });
        yield* fs.writeFileString(
          path.join(directory, "no-infinite-motion.json"),
          `${encodeUnknownJson([
            {
              path: ledgeredPath,
              kind: CSS_KIND,
              fingerprint,
              owner: "fixture-owner",
              reason: "Fixture exception",
              expires: "F5b",
            },
          ])}\n`,
        );

        const result = yield* checkCssMotion({
          directory,
          sources: [
            { path: ledgeredPath, source },
            { path: "apps/web/src/unlisted.css", source },
          ],
        });

        assert.equal(result.exitCode, 1);
        assert.equal(result.problemCount, 1);
        assert.match(result.report, /unlisted apps\/web\/src\/unlisted\.css:css-declaration/u);
      }),
    ),
  );
});
