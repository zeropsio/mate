import {
  type LucideIcon,
  PaletteIcon,
  RectangleHorizontalIcon,
  RowsIcon,
  SmileIcon,
  WorkflowIcon,
} from "lucide-react";
import type { MouseEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";

import type { KitSection } from "../kitSection";
import { KIT_OMISSIONS } from "../omissions";
import { KIT_GUARD_COUNTS, KIT_GUARDS, useKitSourceCounts } from "../shell/kitCounts";
import { isComponentSection, type KitShellFlow } from "../shell/kitPages";
import { KitDocument } from "./KitDocument";

/** A link inside the kit: a real address, opened in place on a plain click. */
export interface KitLink {
  readonly href: string;
  readonly onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** The visual grammar (design-system §3), one line each. */
const PRINCIPLES = [
  ["Depth is tint", "Depth shows as a deeper tint, not another border or shadow."],
  ["Blue acts, teal identifies", "Blue is for what acts; teal is the Mate's identity."],
  ["Tokens only", "Palette and contrast come from the shared tokens, never a literal."],
  ["A mark says its word", "A status mark carries its word, or an accessible name."],
  [
    "One scale",
    "Twelve type steps in brand.ts, a 4 px grid with half-steps, four radii, three durations; nothing between them.",
  ],
  ["Radii run parallel", "An outer radius is the inner one plus the space between them."],
  [
    "An action is a Button",
    "Primary for the one next step, secondary beside it, ghost for quiet tools.",
  ],
  ["A word acts inline", "A word that acts inside a sentence is an InlineButton."],
  ["A list is Rows", "A list's row is a Row; xs for a tree or a dense list."],
  ["A label is a Badge", "A pill in one of five tones, so it never reads as a press."],
] as const;

/** A guard as the overview names it: plain words first, its rule's id under them. */
const GUARD_NAME: Readonly<Record<(typeof KIT_GUARDS)[number]["rule"], string>> = {
  "no-raw-controls": "Raw controls",
  "no-restyle": "Restyled kit components",
  "no-arbitrary-values": "Values off the scale",
  "no-theme-escape-hatches": "Colours around the theme",
  "no-unknown-classes": "Unknown classes",
};

/** One figure of the kit's size: the number large, what it counts under it. */
function Figure({ value, label }: { readonly value: number | undefined; readonly label: string }) {
  return (
    <div className="flex flex-col gap-1">
      {/* The number's line is held while the sources are still being counted. */}
      <dd className="m-0 h-9 font-semibold text-display text-foreground tabular-nums">
        {value === undefined ? null : (
          <span className="animate-zerops-appear motion-reduce:animate-none">{value}</span>
        )}
      </dd>
      <dt className="text-body text-muted-foreground">{label}</dt>
    </div>
  );
}

/** The kit's front page: what it is, how big it is, where to start, how far the app is from it, and what it leaves out. */
export function OverviewPage({
  sections,
  flows,
  linkTo,
}: {
  readonly sections: readonly KitSection[];
  readonly flows: readonly KitShellFlow[];
  readonly linkTo: (page: string) => KitLink;
}) {
  const counts = useKitSourceCounts();
  const components = sections.filter(isComponentSection).length;
  const states = flows.reduce((total, flow) => total + (flow.states?.length ?? 0), 0);
  const toFix = [...KIT_GUARD_COUNTS.values()].reduce((total, count) => total + count.toFix, 0);

  const quickLinks: ReadonlyArray<readonly [string, string, string, LucideIcon]> = [
    ["foundations:colour", "Colour", "Every theme role, light and dark", PaletteIcon],
    ["button", "Button", "The one action, every variant", RectangleHorizontalIcon],
    ["row", "Row", "One row for every list", RowsIcon],
    ["mate-face", "MateFace", "A Mate in every tint and state", SmileIcon],
    ...(flows[0] === undefined
      ? []
      : [
          [`flow:${flows[0].id}`, "Flows", "Whole surfaces in their states", WorkflowIcon] as const,
        ]),
  ];

  return (
    <KitDocument
      line={
        flows.length === 0
          ? "Every component Mate is built from, with the props it renders with. Change a piece here first; the app picks it up everywhere it is used."
          : "Every component Mate is built from, with the props it renders with, and whole surfaces in their states over made-up data. Change a piece here first; the app picks it up everywhere it is used."
      }
      title="Mate kit"
    >
      <dl className="m-0 flex flex-wrap gap-x-16 gap-y-6 border-y py-6">
        <Figure label="Components" value={components} />
        <Figure label="Specimens" value={counts?.specimens} />
        {flows.length === 0 ? null : (
          <>
            <Figure label="Flows" value={flows.length} />
            <Figure label="Flow states" value={states} />
          </>
        )}
      </dl>

      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-12 lg:grid-cols-2">
        <Section line="The pages most work begins on." title="Start here">
          <Card variant="flat">
            <div className="flex flex-col p-1">
              {quickLinks.map(([page, title, line, Icon]) => {
                const link = linkTo(page);
                return (
                  <Row
                    key={page}
                    lead={<Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
                    line={line}
                    pressable
                    render={<a href={link.href} onClick={link.onClick} />}
                    size="sm"
                    title={title}
                  />
                );
              })}
            </div>
          </Card>
        </Section>

        <Section
          count={toFix === 0 ? undefined : `${toFix} to fix`}
          line="Where the app still steps outside the kit. Kept ones do on purpose."
          title="Guard health"
        >
          <Card variant="flat">
            <div className="flex flex-col p-1">
              {KIT_GUARDS.map(({ rule, line }) => {
                const count = KIT_GUARD_COUNTS.get(rule) ?? { toFix: 0, kept: 0 };
                return (
                  <Row
                    badges={
                      <code className="truncate font-mono text-caption text-muted-foreground">
                        {rule}
                      </code>
                    }
                    key={rule}
                    line={line}
                    meta={
                      <span className="flex items-center gap-2">
                        {count.kept > 0 ? (
                          <span className="text-caption text-muted-foreground tabular-nums">
                            {count.kept} kept
                          </span>
                        ) : null}
                        {count.toFix === 0 ? (
                          <Badge tone="success">Clear</Badge>
                        ) : (
                          <Badge tone="warning">{count.toFix} to fix</Badge>
                        )}
                      </span>
                    }
                    size="sm"
                    title={GUARD_NAME[rule]}
                  />
                );
              })}
            </div>
          </Card>
        </Section>
      </div>

      <Section count={PRINCIPLES.length} line={<PrinciplesSource />} title="Principles">
        <ol className="m-0 grid list-none grid-cols-1 gap-x-12 gap-y-5 p-0 lg:grid-cols-2">
          {PRINCIPLES.map(([title, line], index) => (
            <li className="flex gap-3" key={title}>
              <span className="w-5 shrink-0 pt-px font-mono text-caption text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-body text-foreground">{title}</span>
                <span className="text-body text-muted-foreground">{line}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        count={KIT_OMISSIONS.length}
        line="Exports with no look of their own."
        title="Not shown"
      >
        <Card variant="flat">
          <div className="flex flex-col p-1">
            {KIT_OMISSIONS.map((omission) => (
              <Row
                key={omission.name}
                line={
                  <>
                    {omission.reason}{" "}
                    <code className="font-mono text-muted-foreground">{omission.source}</code>
                  </>
                }
                lineWraps
                size="sm"
                title={omission.name}
              />
            ))}
          </div>
        </Card>
      </Section>
    </KitDocument>
  );
}

function PrinciplesSource() {
  return (
    <>
      The grammar every piece follows, from{" "}
      <code className="font-mono text-caption">docs/internals/zerops/design-system.md</code> §3.
    </>
  );
}
