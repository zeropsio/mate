import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Page, type PageWidth } from "~/components/ui/page";
import { PageHeader } from "~/components/ui/page-header";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** The content region beside the owner's 435 px menu at 1786 px wide. */
const WINDOW_WIDTH = 1351;

/**
 * A page at its real size beside the menu, shrunk to fit (`zoom`, a third by default): what its
 * width leaves around it.
 */
export function PageStage({
  zoom = 1 / 3,
  children,
}: {
  readonly zoom?: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-background">
      <div style={{ width: WINDOW_WIDTH, zoom }}>{children}</div>
    </div>
  );
}

/** A page's blocks as they stand on it: its header, then two sections of rows. */
export function PageSample({ title }: { readonly title: string }) {
  return (
    <>
      <PageHeader actions={<Button size="sm">Invite people</Button>} count={3} title={title} />
      <Section count={2} title="People">
        <Card variant="flat">
          <Row line="Owner" title="Petra Malá" />
          <Row line="Developer" title="Jan Svoboda" />
        </Card>
      </Section>
      <Section title="Invitations">
        <Card variant="flat">
          <Row line="Sent yesterday" title="chen@example.com" />
        </Card>
      </Section>
    </>
  );
}

const WIDTHS: ReadonlyArray<{ readonly width: PageWidth; readonly note: string }> = [
  { width: "column", note: "768 px: the conversation's width, a change's review" },
  { width: "page", note: "896 px: Settings, a project's page, a place's" },
  { width: "wide", note: "1024 px: Usage, the team's cards" },
  { width: "full", note: "The window's width: the overview, the code browser" },
];

export default defineKitSection({
  id: "page",
  title: "Page",
  purpose:
    "The frame every page stands in: its column at one of four widths, one gutter, one top, its blocks 48 px apart.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/page.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Each page picks the width its content reads at; the gutter, the top and the rhythm are the frame's."
        title="Widths"
      >
        <SpecimenGrid size="xl">
          {WIDTHS.map(({ width, note }) => (
            <Specimen align="start" key={width} label={`<Page width="${width}">`} note={note}>
              <PageStage>
                <Page width={width}>
                  <PageSample title="Team" />
                </Page>
              </PageStage>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A heading keeps 8 px to its rows; sections and the header stand 48 px apart, so each group reads as one."
        title="Rhythm"
      >
        <SpecimenGrid size="xl">
          <Specimen align="start" label="<Page> · <PageHeader> · <Section>" note="At its real size">
            <div className="w-full rounded-card border border-border bg-background">
              <Page width="column">
                <PageSample title="Team" />
              </Page>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
