import {
  CircleAlertIcon,
  LayoutTemplateIcon,
  type LucideIcon,
  PaletteIcon,
  RectangleHorizontalIcon,
  RowsIcon,
  SmileIcon,
  SquareIcon,
  TypeIcon,
  WorkflowIcon,
} from "lucide-react";
import type { MouseEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Kbd } from "~/components/ui/kbd";
import { Row } from "~/components/ui/row";
import { Section, SectionHeader } from "~/components/ui/section";

import type { KitSection } from "../kitSection";
import { KIT_OMISSIONS } from "../omissions";
import {
  KIT_GUARD_AREAS,
  KIT_GUARD_COUNTS,
  KIT_GUARDS,
  KIT_UNNAMED_GUARDS,
  type KitGuardCount,
  useKitSourceCounts,
} from "../shell/kitCounts";
import type { KitShellFlow } from "../shell/kitPages";
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
  [
    "One rule ink",
    "A hairline inside a surface is the rule: a List's between like things, a Separator between parts.",
  ],
  [
    "Words by what they are",
    "A headline, a heading, a label, a description, a note, a meta fact, an error, a literal: Text.",
  ],
  [
    "One red for wrong",
    "What is wrong is said in the failed status's ink; destructive is a press that deletes.",
  ],
  [
    "Who stands before the name",
    "A person is a PersonAvatar, a Mate its MateFace, anything else a LogoTile.",
  ],
  [
    "A box is the kit's",
    "A Card form, its tone the state of what it holds; a message is a MessageBubble, a picture a PictureFrame.",
  ],
  [
    "A page stands in Page",
    "Its width by what it holds; PageHeader heads it, SectionHeader its sections, PanelBar a pane.",
  ],
  ["A label is a Badge", "A pill in one of five tones, so it never reads as a press."],
  [
    "A state mark is a Dot",
    "Badge's tones as a dot: before a line, or on a corner; a number is a count.",
  ],
  [
    "A quantity is the kit's",
    "One amount against its limit is a Meter, a whole in parts a ShareBar; a series takes a token.",
  ],
] as const;

/** A guard's ledger as its row says it: kept on purpose, and clear or still to fix. */
function GuardMeta({ count }: { readonly count: KitGuardCount }) {
  return (
    <span className="flex items-center gap-2">
      {count.kept > 0 ? (
        <span className="text-caption text-muted-foreground tabular-nums">{count.kept} kept</span>
      ) : null}
      {count.toFix === 0 ? (
        <Badge tone="success">Clear</Badge>
      ) : (
        <Badge tone="warning">{count.toFix} to fix</Badge>
      )}
    </span>
  );
}

/** One guard: what it catches in plain words, its rule's id beside the name, its ledger. */
function GuardRow({
  rule,
  name,
  line,
}: {
  readonly rule: string;
  readonly name: string;
  readonly line?: string;
}) {
  return (
    <Row
      badges={<code className="truncate font-mono text-caption text-muted-foreground">{rule}</code>}
      line={line}
      meta={<GuardMeta count={KIT_GUARD_COUNTS.get(rule) ?? { toFix: 0, kept: 0 }} />}
      size="sm"
      title={name}
    />
  );
}

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
  const states = flows.reduce((total, flow) => total + (flow.states?.length ?? 0), 0);
  const toFix = [...KIT_GUARD_COUNTS.values()].reduce((total, count) => total + count.toFix, 0);

  const quickLinks: ReadonlyArray<readonly [string, string, string, LucideIcon]> = [
    ["foundations:colour", "Colour", "Every theme role, light and dark", PaletteIcon],
    ["text", "Text", "Words by what they are: a heading, a note, an error", TypeIcon],
    ["button", "Button", "The one action, every variant", RectangleHorizontalIcon],
    ["row", "Row", "One row for every list", RowsIcon],
    ["card", "Card", "Every box: a panel, a well, a slot to fill", SquareIcon],
    ["page", "Page", "A page's frame, width and rhythm", LayoutTemplateIcon],
    ["failure", "Failure", "Something failed, said one way everywhere", CircleAlertIcon],
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
        <Figure label="Components" value={sections.length} />
        <Figure label="Specimens" value={counts?.specimens} />
        {flows.length === 0 ? null : (
          <>
            <Figure label="Flows" value={flows.length} />
            <Figure label="Flow states" value={states} />
          </>
        )}
      </dl>

      <Section line={<StartHereLine />} title="Start here">
        <Card variant="flat">
          <div className="grid grid-cols-1 p-1 lg:grid-cols-2">
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
        line="Every guard the build runs over the app, and where the app still steps outside it. Kept ones do on purpose."
        title="Guard health"
      >
        {/* The look's long list in one column; motion and data stacked in the other. */}
        <div className="grid grid-cols-1 items-start gap-x-8 gap-y-8 lg:grid-cols-2">
          {[KIT_GUARD_AREAS.slice(0, 1), KIT_GUARD_AREAS.slice(1)].map((areas) => (
            <div className="flex flex-col gap-8" key={areas.join()}>
              {areas.map((area) => (
                <div className="flex flex-col gap-2" key={area}>
                  <SectionHeader level={3} size="panel" title={area} />
                  <Card variant="flat">
                    <div className="flex flex-col p-1">
                      {KIT_GUARDS.filter((guard) => guard.area === area).map((guard) => (
                        <GuardRow
                          key={guard.rule}
                          line={guard.line}
                          name={guard.name}
                          rule={guard.rule}
                        />
                      ))}
                      {area === "The look"
                        ? KIT_UNNAMED_GUARDS.map((rule) => (
                            <GuardRow key={rule} name={rule} rule={rule} />
                          ))
                        : null}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

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

function StartHereLine() {
  return (
    <>
      The pages most work begins on. To find a piece by its job, press <Kbd>/</Kbd> and say it: “a
      divider”, “a copyable command”, “a page”.
    </>
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
