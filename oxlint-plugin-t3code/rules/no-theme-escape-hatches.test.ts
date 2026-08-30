import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { FINDING_MESSAGE_MARKER, loadExceptionLedger, type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE_NAME = "no-theme-escape-hatches";
const LEDGER_DIRECTORY_ENV = "T3CODE_THEME_ESCAPE_HATCHES_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const harnesses = {
  zeropsWeb: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/zerops/Probe.tsx",
  }),
  zeropsMobile: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/components/zerops/Probe.tsx",
  }),
  web: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/Probe.tsx",
  }),
  mobile: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/features/Probe.tsx",
  }),
  sidebarLogic: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/Sidebar.logic.ts",
  }),
  threadStatusIndicators: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/ThreadStatusIndicators.tsx",
  }),
  agentActivity: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/widgets/AgentActivity.tsx",
  }),
  threadListV2: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/features/threads/threadListV2.ts",
  }),
  mobileThreadItems: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
  }),
  webTest: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/zerops/Probe.test.tsx",
  }),
  webStory: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/components/zerops/Probe.stories.tsx",
  }),
  webThemeSource: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/web/src/themePalette.ts",
  }),
  mobileThemeSource: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/lib/mobileTheme.ts",
  }),
  reviewedInterop: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/features/home/HomeHeader.tsx",
  }),
  gitOverlayInterop: createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
    filename: "apps/mobile/src/features/threads/GitActionProgressOverlay.tsx",
  }),
} as const;

const entry = (path: string, kind: string, fingerprint: string): ExceptionEntry => ({
  path,
  kind,
  fingerprint,
  owner: "karel",
  reason: "fixture exception",
  expires: "never",
});

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "theme-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, `${RULE_NAME}.json`),
        `${encodeUnknownJson(entries)}\n`,
      );

      const environment = globalThis.process.env;
      const previous = environment[LEDGER_DIRECTORY_ENV];
      environment[LEDGER_DIRECTORY_ENV] = directory;

      return yield* effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete environment[LEDGER_DIRECTORY_ENV];
            else environment[LEDGER_DIRECTORY_ENV] = previous;
          }),
        ),
      );
    }),
  );

describe("t3code/no-theme-escape-hatches", () => {
  const validCases = [
    {
      name: "allows SVG geometry, ids, URL fragments, semantic arbitrary tokens, and comments",
      harness: harnesses.zeropsWeb,
      source: `
        // The documentation example mentions #fff.
        const icon = (
          <svg viewBox="0 0 24 24" id="#x" className="text-[var(--x)] bg-[color:var(--x)]">
            <path d="M0 0h#fff" mask="url(#abcdef)" />
          </svg>
        );
      `,
    },
    {
      name: "allows semantic mobile theme classes including text-adaptive utilities",
      harness: harnesses.mobile,
      source: `const surface = <View className="bg-surface text-foreground text-adaptive-red" />;`,
    },
    {
      name: "allows unrelated functions with legacy hook names",
      harness: harnesses.mobile,
      source: `
        const useCSSVariable = () => "local value";
        const useThemeColor = () => "local color";
        export const values = [useCSSVariable(), useThemeColor()];
      `,
    },
    {
      name: "allows unrelated imports with legacy hook names",
      harness: harnesses.mobile,
      source: `
        import { useThemeColor } from "./unrelated-library";
        export const foreground = useThemeColor();
      `,
    },
    {
      name: "allows erased type-only theme imports",
      harness: harnesses.mobile,
      source: `
        import type { useCSSVariable } from "uniwind";
        import { type useCSSVariable as CSSVariableHook } from "uniwind";
        import type { useThemeColor } from "../../../hooks/useThemeColor";
        import type { useUniwindTheme } from "../../../lib/useUniwindTheme";
        export type ThemeHooks = [
          typeof useCSSVariable,
          typeof CSSVariableHook,
          typeof useThemeColor,
          typeof useUniwindTheme,
        ];
      `,
    },
    {
      name: "allows appearance words without variant syntax in ordinary mobile copy",
      harness: harnesses.mobile,
      source: `
        const message = "Set dark mode manually";
        const detail = "For dark: high contrast mode is available";
        const label = <Text accessibilityLabel="Light theme">Theme</Text>;
      `,
    },
    {
      name: "does not conflate shadowed Uniwind namespaces",
      harness: harnesses.mobile,
      source: `
        import * as Uniwind from "uniwind";
        export function readDirect(Uniwind: { useCSSVariable: () => string }) {
          return Uniwind.useCSSVariable();
        }
        export function readDestructured(Uniwind: { useCSSVariable: () => string }) {
          const { useCSSVariable } = Uniwind;
          return useCSSVariable();
        }
      `,
    },
    {
      name: "allows reviewed native interop boundaries",
      harness: harnesses.reviewedInterop,
      source: `
        import { useUniwindTheme } from "../../lib/useUniwindTheme";
        export const foreground = useUniwindTheme().colors.foreground;
      `,
    },
    {
      name: "allows the reviewed native liquid-glass theme boundary",
      harness: harnesses.gitOverlayInterop,
      source: `
        import { useUniwindTheme } from "../../lib/useUniwindTheme";
        export const tint = useUniwindTheme()["--color-glass-surface"];
      `,
    },
    {
      name: "allows web appearance syntax outside a class-like literal",
      harness: harnesses.web,
      source: `const documentation = "dark:bg-black";`,
    },
    {
      name: "allows raw colours outside semantic sinks",
      harness: harnesses.zeropsWeb,
      source: `const documentation = "#fff rgb(0 0 0)";`,
    },
    {
      name: "allows semantic colour functions in style sinks",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div style={{ color: "hsl(var(--x))", background: "oklch(from var(--x) l c h)" }} />;`,
    },
    {
      name: "allows non-colour arbitrary values, URL fragments, and function substrings",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-[url(#abcdef)] text-[length:12px] shadow-[0_0_drgb(0_0_0)] [mask-type:luminance] ![mask-type:luminance] [color:var(--x)]/50 bg-[var(--x)]/50" />;`,
    },
    {
      name: "allows raw-colour shapes inside double-quoted arbitrary content",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className={'content-["label:#fff"]'} />;`,
    },
    {
      name: "allows tokens with excess closing brackets",
      harness: harnesses.zeropsWeb,
      source: `const surface = <><div className="]:text-red-500" /><div className="foo]:text-red-500" /></>;`,
    },
    ...[
      "data-[state=open]:bg-[var(--x)]",
      "supports-[display:grid]:flex",
      "[&:has(:checked)]:[mask-type:luminance]",
      "text-[length:12px]",
      "bg-[color:var(--x)]",
      "bg-[url(#abcdef)]",
      "bg-[url('#fff')]",
      "content-['label:#fff']",
      "content-['label:rgb(0_0_0)']",
      `[content:'label:#fff']`,
      "content-['#fff']",
      ":[color:#fff]",
      "hover::[color:#fff]",
      "[&:has(:checked)]::[color:#fff]",
      "bg-[linear-gradient(to_right,var(--a)_0%,var(--b)_100%)]",
      "[mask:url(#abc)_no-repeat]",
      "[background:redwood_url(x)]",
      "[&::-webkit-scrollbar]:w-2",
      "[&::before]:content-['x']",
      "before:content-['']_text-[#fff]",
      "bg-[#fff]_x",
      "[color:#fff]_[background:#000]",
      "[mask-type:luminance]",
    ].map((utility) => ({
      name: `allows the non-colour arbitrary utility ${utility}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    {
      name: "allows current and transparent utilities without theme roles",
      harness: harnesses.zeropsWeb,
      source: `const surface = <svg className="fill-current stroke-current/50 from-transparent divide-transparent caret-current to-current" />;`,
    },
    {
      name: "allows dynamic pull request references in a widened status consumer",
      harness: harnesses.threadStatusIndicators,
      source: [
        "const label = `#${prNumber}`;",
        "const tooltip = `${changeRequestShortName} #${prNumber} - ${state}`;",
      ].join("\n"),
    },
    {
      name: "does not treat a locally declared cn as a class builder",
      harness: harnesses.web,
      source: `const cn = (value: string) => value; const result = cn("text-red-600");`,
    },
    {
      name: "does not treat cn imported from an unrelated module as a class builder",
      harness: harnesses.web,
      source: `import { cn } from "fake-package"; const result = cn("text-red-600");`,
    },
    {
      name: "does not conflate a shadowed canonical class-builder binding",
      harness: harnesses.web,
      source: `
        import { cn } from "~/lib/utils";
        const local = (cn: (value: string) => string) => cn("text-red-600");
      `,
    },
    {
      name: "does not register type-only class-builder imports",
      harness: harnesses.web,
      source: `import type { cva } from "class-variance-authority"; const value = "text-red-600";`,
    },
    {
      name: "allows dynamically concatenated incomplete class fragments",
      harness: harnesses.zeropsWeb,
      source: `import { cn } from "~/lib/utils"; const result = cn("text-", color, "-500");`,
    },
    {
      name: "skips test files",
      harness: harnesses.webTest,
      source: `const icon = <path fill="#fff" />;`,
    },
    {
      name: "skips story files",
      harness: harnesses.webStory,
      source: `const icon = <path fill="#fff" />;`,
    },
    {
      name: "skips the web theme source",
      harness: harnesses.webThemeSource,
      source: `export const color = "#fff";`,
    },
    {
      name: "skips the mobile theme source",
      harness: harnesses.mobileThemeSource,
      source: `export const color = "#fff";`,
    },
  ] as const;

  for (const testCase of validCases) {
    testCase.harness.valid(testCase.name, testCase.source);
  }

  const invalidCases = [
    {
      name: "reports SVG fill literals",
      harness: harnesses.zeropsWeb,
      source: `const icon = <circle fill="#fff" />;`,
    },
    {
      name: "reports all SVG colour attributes",
      harness: harnesses.zeropsWeb,
      source: `const icon = <svg fill="#fff" stroke="rgb(0 0 0)" color="#abc" floodColor="#def" lightingColor="#123"><stop stopColor="#456" /></svg>;`,
      count: 6,
    },
    {
      name: "reports inline style colour literals",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div style={{ color: "#ff0000" }} />;`,
    },
    {
      name: "reports StyleSheet and nested style-array colour literals",
      harness: harnesses.mobile,
      source: `
        const styles = StyleSheet.create({ x: { shadowColor: "rgba(0,0,0,0.5)" } });
        const surface = <View style={[{ color: "#fff" }, styles.x]} />;
      `,
      count: 2,
    },
    {
      name: "reports CSS variable object literals",
      harness: harnesses.zeropsWeb,
      source: `const variables = { "--accent": "#fff" };`,
    },
    {
      name: "reports complete palette utilities for every colour-property prefix",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="from-red-500 via-white to-black divide-red-500 ring-red-500 accent-red-500 caret-red-500 decoration-red-500 outline-red-500 shadow-red-500 placeholder-red-500 group-hover:text-red-500 data-[state=on]:bg-red-500" />;`,
    },
    ...[
      "ring-black/5",
      "fill-white",
      "shadow-black",
      "outline-white/20",
      "accent-black",
      "decoration-white",
      "placeholder-black/30",
      "via-white/40",
    ].map((utility) => ({
      name: `reports the special colour utility ${utility}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    {
      name: "reports dynamic palette utilities in imported class builders",
      harness: harnesses.zeropsWeb,
      source: `import { cn } from "~/lib/utils"; const surface = cn("p-2", \`text-\${x}-500\`);`,
    },
    {
      name: "reports aliased canonical class-builder bindings",
      harness: harnesses.web,
      source: `import { cn as cx } from "~/lib/utils"; const surface = cx("text-cyan-700");`,
    },
    {
      name: "reports palette utilities in relative web class builders",
      harness: harnesses.web,
      source: `import { cn } from "../lib/utils"; const result = cn("text-red-600");`,
    },
    {
      name: "reports palette utilities in relative mobile class builders",
      harness: harnesses.mobile,
      source: `import { cn } from "../../lib/cn"; const result = cn("text-red-500");`,
    },
    ...[
      ["cn", "~/lib/utils"],
      ["clsx", "clsx"],
      ["cva", "class-variance-authority"],
      ["twMerge", "tailwind-merge"],
      ["tv", "tailwind-variants"],
    ].map(([name, modulePath]) => ({
      name: `reports palette utilities passed to imported ${name}`,
      harness: harnesses.web,
      source: `import { ${name} } from "${modulePath}"; const surface = ${name}("text-lime-700");`,
    })),
    {
      name: "reports opacity on bg-white",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-white/50" />;`,
    },
    {
      name: "reports opacity on text-black",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="text-black/75" />;`,
    },
    {
      name: "reports arbitrary opacity on bg-black",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-black/[0.75]" />;`,
    },
    {
      name: "reports trailing Tailwind important modifiers",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="text-red-600!" />;`,
    },
    {
      name: "reports leading Tailwind important modifiers",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="!bg-white" />;`,
    },
    {
      name: "reports arbitrary hex text utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="text-[#d97757]" />;`,
    },
    {
      name: "reports arbitrary hex fill utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <svg className="fill-[#26251E]" />;`,
    },
    {
      name: "reports arbitrary rgb background utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-[rgb(0,0,0)]" />;`,
    },
    {
      name: "reports arbitrary oklch background utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-[oklch(0.5_0.1_200)]" />;`,
    },
    ...["!bg-[#fff]", "bg-[#fff]/50"].map((utility) => ({
      name: `reports the modified arbitrary-value utility ${utility}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    ...[
      "bg-[linear-gradient(to_right,#fff_0%,#000_100%)]",
      "shadow-[0_0_0_#fff_inset]",
      "[background:#abc_url(x.png)]",
      "w-[calc(100%_-_#fff)]",
    ].map((utility) => ({
      name: `reports a hex colour followed by a Tailwind separator in ${utility}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    {
      name: "reports a named colour followed by a Tailwind separator",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="[background:red_url(x)]" />;`,
    },
    {
      name: "reports raw colours after quoted brackets in arbitrary values",
      harness: harnesses.zeropsWeb,
      source: `const surface = <><div className="bg-[url('x[y')_#fff]" /><div className="content-['[']" /></>;`,
      count: 1,
    },
    {
      name: "reports raw colours after quoted brackets in arbitrary properties",
      harness: harnesses.zeropsWeb,
      source: `const surface = <><div className="[background:url('foo[bar.png')_#fff]" /><div className="bg-[url('a[b')]" /></>;`,
      count: 1,
    },
    {
      name: "reports palette utilities after quoted brackets in arbitrary variants",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="[&[data-label='[']]:text-red-500" />;`,
    },
    {
      name: "reports arbitrary colours after quoted brackets in arbitrary variants",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="[&[data-label='[']]:[color:#fff]" />;`,
    },
    {
      name: "reports balanced variants but ignores an excess closing bracket",
      harness: harnesses.zeropsWeb,
      source: `const surface = <><div className="[&::before]]:text-red-500" /><div className="[&::before]:text-red-500" /></>;`,
      count: 1,
    },
    ...["[&::before]:text-red-500", "[&::after]:bg-white", "[&::placeholder]:text-red-500"].map(
      (utility) => ({
        name: `reports palette utilities after pseudo-element variants in ${utility}`,
        harness: harnesses.zeropsWeb,
        source: `const surface = <div className="${utility}" />;`,
      }),
    ),
    {
      name: "reports combined opacity and important modifiers on arbitrary values",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-[#fff]/50!" />;`,
    },
    ...[
      "data-[state=open]:[color:#fff]",
      "aria-[expanded=true]:[background:#fff]",
      "supports-[display:grid]:[border-color:#fff]",
      "min-[320px]:[--brand:#fff]",
      "data-[state=open]:![color:#fff]/50",
    ].map((utility) => ({
      name: `reports arbitrary-property colours after the variant in ${utility}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    ...["bg-[color:#fff]", "text-[color:rgb(0_0_0)]", "border-[color:hsl(200_50%_50%)]/50"].map(
      (utility) => ({
        name: `reports raw colours after the arbitrary-value type hint in ${utility}`,
        harness: harnesses.zeropsWeb,
        source: `const surface = <div className="${utility}" />;`,
      }),
    ),
    {
      name: "reports palette utilities after variants with internal colons",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="[&:has(:checked)]:text-red-500" />;`,
    },
    ...[
      ["arbitrary colour properties", "[color:#fff]"],
      ["variant-prefixed arbitrary colour properties", "hover:[color:#fff]"],
      ["arbitrary background properties", "[background:rgb(0_0_0)]"],
      ["arbitrary custom properties", "[--x:#000]"],
      ["variant-prefixed arbitrary properties", "hover:[fill:#fff]"],
      ["prefix-important arbitrary properties", "![color:#fff]"],
      ["variant-prefixed important arbitrary properties", "md:![color:#fff]"],
      ["trailing-important arbitrary properties", "[color:#fff]!"],
      ["opacity-modified arbitrary properties", "[color:#fff]/50"],
      [
        "important arbitrary background properties with arbitrary opacity",
        "hover:![background:rgb(0_0_0)]/[0.5]",
      ],
    ].map(([description, utility]) => ({
      name: `reports ${description}`,
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="${utility}" />;`,
    })),
    {
      name: "reports raw colours nested inside arbitrary gradients",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-[radial-gradient(circle_at_75%_25%,rgba(136,204,255,0.5),transparent_38%),linear-gradient(135deg,#2468df,#172f82)]" />;`,
    },
    {
      name: "reports raw colours nested inside arbitrary drop shadows",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="drop-shadow-[0_1px_2px_#0008]" />;`,
    },
    {
      name: "reports rgb colours after Tailwind arbitrary-value separators",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="shadow-[0_0_0_1px_rgb(0_0_0/0.1)]" />;`,
    },
    {
      name: "reports the live resource telemetry arbitrary shadow",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03),0_8px_30px_rgb(0_0_0/0.035)]" />;`,
    },
    {
      name: "reports physical directional border palette utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="border-x-red-500 border-y-orange-500 border-t-blue-600 border-r-green-500 border-b-pink-500 border-l-zinc-500" />;`,
    },
    {
      name: "reports logical directional border palette utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="border-s-red-500 border-e-blue-600" />;`,
    },
    ...["border-b-white", "border-y-black/10", "border-s-white/50", "border-x-black"].map(
      (utility) => ({
        name: `reports the directional special colour utility ${utility}`,
        harness: harnesses.zeropsWeb,
        source: `const surface = <div className="${utility}" />;`,
      }),
    ),
    {
      name: "reports directional divide palette utilities",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="divide-x-red-500" />;`,
    },
    ...["#", "rgb(", "rgba(", "hsl(", "oklch("].map((prefix) => ({
      name: `reports dynamic ${prefix} construction in a semantic sink`,
      harness: harnesses.zeropsWeb,
      source: `const style = { color: \`${prefix}\${value}\` };`,
    })),
    {
      name: "reports dynamic hex construction only when it is in a semantic sink",
      harness: harnesses.zeropsWeb,
      source: "const surface = <div style={{ color: `#${hex}` }} />;",
    },
    {
      name: "reports an indirect palette table in Sidebar.logic",
      harness: harnesses.sidebarLogic,
      source: `const status = { colorClass: "text-cyan-950" };`,
    },
    {
      name: "reports a returned appearance class in ThreadStatusIndicators",
      harness: harnesses.threadStatusIndicators,
      source: `const statusClass = () => "dark:text-fuchsia-950";`,
    },
    {
      name: "reports raw phase tints in AgentActivity without making it zero tolerance",
      harness: harnesses.agentActivity,
      source: `const phaseTint = () => "#123abc";`,
    },
    {
      name: "reports raw status colours in threadListV2",
      harness: harnesses.threadListV2,
      source: `const statusTint = "rgb(1 2 3)";`,
    },
    {
      name: "reports palette status values in mobile thread-list-v2-items",
      harness: harnesses.mobileThreadItems,
      source: `const statusClass = "text-fuchsia-950";`,
    },
    {
      name: "reports new React theme subscriptions",
      harness: harnesses.mobile,
      source: `import { useCSSVariable } from "uniwind";`,
      assertion: (output: string) => assert.match(output, /semantic className/),
    },
    {
      name: "reports the retired theme color hook",
      harness: harnesses.mobile,
      source: `import { useThemeColor } from "../../../hooks/useThemeColor";`,
      assertion: (output: string) => assert.match(output, /bypasses semantic Uniwind classes/),
    },
    {
      name: "reports guarded hooks imported with TypeScript extensions",
      harness: harnesses.mobile,
      source: `
        import { useThemeColor } from "../../../hooks/useThemeColor.ts";
        import { useUniwindTheme } from "../../../lib/useUniwindTheme.ts";
      `,
      count: 2,
      assertion: (output: string) => {
        assert.match(output, /bypasses semantic Uniwind classes/);
        assert.match(output, /native\/third-party interop boundary/);
      },
    },
    {
      name: "reports unreviewed native interop subscriptions",
      harness: harnesses.mobile,
      source: `import { useUniwindTheme } from "../../../lib/useUniwindTheme";`,
      assertion: (output: string) => assert.match(output, /native\/third-party interop boundary/),
    },
    // Intentional changes from the retired rule: web class-like literals are now guarded, mobile
    // keeps its any-string appearance scope, and diagnostics carry the shared ledger message.
    {
      name: "reports appearance variants in web class-like literals",
      harness: harnesses.zeropsWeb,
      source: `const surface = <div className="bg-white dark:bg-black" />;`,
    },
    {
      name: "reports appearance variants in mobile string literals",
      harness: harnesses.mobile,
      source: `const surface = <View className="bg-white dark:bg-black" />;`,
      assertion: (output: string) => assert.match(output, /adaptive semantic theme tokens/),
    },
    {
      name: "reports appearance variants in mobile template literals",
      harness: harnesses.mobile,
      source: "const className = `bg-black light:bg-white`;",
    },
    {
      name: "reports escaped appearance variants in mobile template literals",
      harness: harnesses.mobile,
      source: "const className = `dark\\u003abg-black`;",
    },
    {
      name: "reports appearance variants split by a mobile template expression",
      harness: harnesses.mobile,
      source: "const className = `dark:${value}`;",
      count: 1,
    },
    {
      name: "reports a complete class token in the first template quasi",
      harness: harnesses.zeropsWeb,
      source: "const surface = <div className={`text-red-500${value}`} />;",
      count: 1,
    },
    {
      name: "reports a complete class token in the last template quasi",
      harness: harnesses.zeropsWeb,
      source: "const surface = <div className={`${value}text-blue-600`} />;",
      count: 1,
    },
    {
      name: "reports appearance variants through nested class-map indirection",
      harness: harnesses.mobile,
      source: `
        const styles = { variants: { root: "bg-white dark:bg-black" } };
        const root = styles.variants.root;
        export const surface = <View className={root} />;
      `,
      assertion: (output: string) => assert.match(output, /adaptive semantic theme tokens/),
      count: 1,
    },
    {
      name: "reports appearance variants passed to class builders",
      harness: harnesses.mobile,
      source: `const surface = cn("bg-white", enabled && "dark:bg-black");`,
    },
    {
      name: "reports negative and important appearance variants",
      harness: harnesses.mobile,
      source: `const className = "dark:-mt-2 light:!bg-white";`,
    },
    {
      name: "reports namespace CSS variable subscriptions",
      harness: harnesses.mobile,
      source: `import * as Uniwind from "uniwind"; export const foreground = Uniwind.useCSSVariable("--color-foreground");`,
    },
    {
      name: "reports destructured namespace CSS variable subscriptions",
      harness: harnesses.mobile,
      source: `
        import * as Uniwind from "uniwind";
        const { useCSSVariable: resolveVariable } = Uniwind;
        export const foreground = resolveVariable("--color-foreground");
      `,
    },
    {
      name: "reports aliased namespace CSS variable subscriptions",
      harness: harnesses.mobile,
      source: `
        import * as Uniwind from "uniwind";
        const Theme = Uniwind;
        const NestedTheme = Theme;
        export const foreground = NestedTheme.useCSSVariable("--color-foreground");
      `,
    },
    {
      name: "reports object-rest namespace CSS variable subscriptions",
      harness: harnesses.mobile,
      source: `
        import * as Uniwind from "uniwind";
        const { ...Theme } = Uniwind;
        export const foreground = Theme.useCSSVariable("--color-foreground");
      `,
    },
    {
      name: "reports namespace access to the retired theme hook",
      harness: harnesses.mobile,
      source: `import * as ThemeColor from "../../../hooks/useThemeColor"; export const foreground = ThemeColor.useThemeColor({}, "foreground");`,
    },
    {
      name: "reports destructured namespace access to the retired theme hook",
      harness: harnesses.mobile,
      source: `
        import * as ThemeColor from "../../../hooks/useThemeColor.ts";
        const { useThemeColor: resolveThemeColor } = ThemeColor;
        export const foreground = resolveThemeColor({}, "foreground");
      `,
    },
    {
      name: "includes the machine-readable ledger marker",
      harness: harnesses.zeropsWeb,
      source: `const icon = <path stroke="#abc" />;`,
      assertion: (output: string) => assert.include(output, FINDING_MESSAGE_MARKER),
    },
  ] as const;

  for (const testCase of invalidCases) {
    testCase.harness.invalid(
      testCase.name,
      testCase.source,
      "assertion" in testCase ? testCase.assertion : undefined,
      "count" in testCase ? testCase.count : undefined,
    );
  }
});

it.layer(NodeServices.layer)("temporary exception ledger", (it) => {
  it.effect("suppresses exact ordinary findings and reviewed mobile interop", () =>
    withFixtureLedger(
      [
        entry("apps/web/src/components/Probe.tsx", "Literal", '"text-red-600"'),
        entry("apps/mobile/src/features/Probe.tsx", "ImportSpecifier", "useUniwindTheme"),
      ],
      Effect.gen(function* () {
        yield* harnesses.web.run(`const surface = <div className="text-red-600" />;`);
        yield* harnesses.mobile.run(`import { useUniwindTheme } from "../lib/useUniwindTheme";`);
      }),
    ),
  );

  it.effect("does not consult the ledger inside a zero-tolerance directory", () =>
    withFixtureLedger(
      [
        entry("apps/web/src/components/zerops/Probe.tsx", "Literal", '"text-red-600"'),
        entry("apps/mobile/src/components/zerops/Probe.tsx", "Literal", '"text-red-600"'),
      ],
      Effect.all([
        harnesses.zeropsWeb.runAndExpectFailure(
          `const surface = <div className="text-red-600" />;`,
        ),
        harnesses.zeropsMobile.runAndExpectFailure(
          `const surface = <View className="text-red-600" />;`,
        ),
      ]).pipe(
        Effect.tap((outputs) =>
          Effect.sync(() => outputs.forEach((output) => assert.include(output, RULE_NAME))),
        ),
      ),
    ),
  );
});

it("keeps the real ledger out of zero-tolerance directories", () => {
  const ledger = loadExceptionLedger(RULE_NAME);
  const forbidden = [
    "apps/web/src/zerops/",
    "apps/web/src/components/zerops/",
    "apps/mobile/src/components/zerops/",
    "apps/mobile/src/features/zerops/",
  ];

  assert.deepStrictEqual(
    ledger.entries.filter((candidate) =>
      forbidden.some((prefix) => candidate.path.startsWith(prefix)),
    ),
    [],
  );
});
