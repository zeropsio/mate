import {
  LayersIcon,
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

function StatTile({
  value,
  label,
  line,
}: {
  readonly value: number | undefined;
  readonly label: string;
  readonly line: string;
}) {
  return (
    <Card size="md" variant="flat">
      <span className="font-semibold text-display tabular-nums">
        {value === undefined ? "–" : value}
      </span>
      <span className="flex flex-col">
        <span className="font-medium text-body">{label}</span>
        <span className="text-caption text-muted-foreground">{line}</span>
      </span>
    </Card>
  );
}

/** The kit's front page: what it is, how big it is, how far the app is from it, where to start, and what it leaves out. */
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
  const ledgersShipped = KIT_GUARD_COUNTS.size > 0;
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
      line="Every component Mate is built from, with the props it renders with, and whole surfaces in their states over made-up data. Change a piece here first; the app picks it up everywhere it is used."
      title="Mate kit"
    >
      <div className="grid grid-cols-4 gap-4">
        <StatTile label="Components" line="Chosen and kit, in their sections" value={components} />
        <StatTile label="Specimens" line="Variants and states drawn" value={counts?.specimens} />
        <StatTile
          label="Flows"
          line={flows.length === 0 ? "This build carries none" : "Surfaces over fixtures"}
          value={flows.length}
        />
        <StatTile label="Flow states" line="Each one shareable" value={states} />
      </div>

      <div className="grid grid-cols-2 items-start gap-8">
        <Section count={ledgersShipped ? `${toFix} to fix` : undefined} title="Guard health">
          <Card variant="flat">
            <div className="flex flex-col p-1">
              {KIT_GUARDS.map(({ rule, line }) => {
                const count = KIT_GUARD_COUNTS.get(rule);
                return (
                  <Row
                    key={rule}
                    line={line}
                    meta={
                      count === undefined ? (
                        "—"
                      ) : (
                        <span className="flex items-center gap-2">
                          {count.kept > 0 ? (
                            <span className="text-caption text-muted-foreground">
                              {count.kept} kept
                            </span>
                          ) : null}
                          <Badge tone={count.toFix === 0 ? "success" : "warning"}>
                            {count.toFix}
                          </Badge>
                        </span>
                      )
                    }
                    size="sm"
                    title={<code className="font-mono">{rule}</code>}
                  />
                );
              })}
            </div>
          </Card>
          <p className="m-0 text-caption text-muted-foreground">
            {ledgersShipped
              ? "Each number is a place that still breaks the rule: drive them to zero. Kept ones break it on purpose, each with its reason (a vendor's icon colours, a native picker). A ledger only shrinks."
              : "This build does not carry the guards' ledgers; the dev server and the design harness do."}
          </p>
        </Section>

        <Section title="Start here">
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
      </div>

      <Section count={PRINCIPLES.length} title="Principles">
        <div className="grid grid-cols-2 gap-x-8">
          {PRINCIPLES.map(([title, line], index) => (
            <Row
              key={title}
              lead={
                <span className="font-medium text-caption text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
              }
              line={line}
              lineWraps
              size="sm"
              title={title}
            />
          ))}
        </div>
        <p className="m-0 flex items-center gap-1.5 text-caption text-muted-foreground">
          <LayersIcon aria-hidden="true" className="size-3.5" />
          From the design guide, docs/internals/zerops/design-system.md §3.
        </p>
      </Section>

      <Section count={KIT_OMISSIONS.length} title="Not shown">
        <Card variant="flat">
          <div className="flex flex-col p-1">
            {KIT_OMISSIONS.map((omission) => (
              <Row
                key={omission.name}
                line={
                  <>
                    {omission.reason}{" "}
                    <code className="font-mono text-muted-foreground/80">{omission.source}</code>
                  </>
                }
                lineWraps
                size="sm"
                title={<code className="font-mono">{omission.name}</code>}
              />
            ))}
          </div>
        </Card>
      </Section>
    </KitDocument>
  );
}
