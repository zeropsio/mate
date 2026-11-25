import { MoreHorizontalIcon, PanelRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardFrame,
  CardFrameDescription,
  CardFrameFooter,
  CardFrameHeader,
  CardFrameTitle,
  CardHeader,
  CardPanel,
  CardTitle,
} from "~/components/ui/card";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function SampleCard({ variant }: { readonly variant?: "default" | "flat" | "sheet" }) {
  return (
    <Card variant={variant}>
      <CardHeader>
        <CardTitle>storefront</CardTitle>
        <CardDescription>Node.js 22 · two containers</CardDescription>
        <CardAction>
          <Button aria-label="More" size="icon-sm" variant="ghost">
            <MoreHorizontalIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel>
        <p className="m-0 text-body">Deployed eight minutes ago from main.</p>
      </CardPanel>
      <CardFooter>
        <Button size="sm" variant="secondary">
          Open logs
        </Button>
      </CardFooter>
    </Card>
  );
}

function CardSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="One thing's name, facts and actions on a bounded surface."
        title="Variants"
      >
        <SpecimenGrid size="lg">
          <Specimen label='variant="default"'>
            <div className="w-full max-w-80">
              <SampleCard />
            </div>
          </Specimen>
          <Specimen label='variant="flat"'>
            <div className="w-full max-w-80">
              <SampleCard variant="flat" />
            </div>
          </Specimen>
          <Specimen label='variant="sheet"' note="A card standing alone among its kind">
            <div className="w-full max-w-80">
              <SampleCard variant="sheet" />
            </div>
          </Specimen>
          <Specimen label='variant="flat" tone="failed" size="sm"' note="A thing that broke">
            <div className="w-full max-w-80">
              <Card size="sm" tone="failed" variant="flat">
                <span className="font-medium text-body">Deploy failed</span>
                <span className="text-caption text-muted-foreground">
                  The build stopped at step 3.
                </span>
              </Card>
            </div>
          </Specimen>
          <Specimen label="<CardHeader> · <CardTitle>" note="A title and nothing else">
            <div className="w-full max-w-80">
              <Card>
                <CardHeader>
                  <CardTitle>A card with a title and nothing else</CardTitle>
                </CardHeader>
              </Card>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="The whole card one press: at rest, and lit by hover or focus."
        title="Pressable"
      >
        <SpecimenGrid size="lg">
          <Specimen label="pressable · data-highlighted" note="A choice of two">
            <div className="grid w-full max-w-96 grid-cols-2 gap-2">
              <Card pressable>
                <span className="flex flex-col items-start gap-1 p-3">
                  <span className="flex items-center gap-2 font-medium text-body">
                    <PanelRightIcon className="size-4" />
                    Files
                  </span>
                  <span className="text-caption text-muted-foreground">
                    Browse the Mate's code.
                  </span>
                </span>
              </Card>
              <Card data-highlighted="" pressable>
                <span className="flex flex-col items-start gap-1 p-3">
                  <span className="flex items-center gap-2 font-medium text-body">
                    <PanelRightIcon className="size-4" />
                    Terminal
                  </span>
                  <span className="text-caption text-muted-foreground">
                    A shell in the container.
                  </span>
                </span>
              </Card>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A card inside a card, and a frame around several." title="Nesting">
        <SpecimenGrid size="xl">
          <Specimen
            label='variant="flat" size="md" · variant="inset" size="sm"'
            note="A deeper tint inside, no second border"
          >
            <div className="w-full max-w-[28rem]">
              <Card size="md" variant="flat">
                <p className="m-0 text-body">A card on the page.</p>
                <Card size="sm" variant="inset">
                  <p className="m-0 text-muted-foreground text-body">
                    A card inside it: a deeper tint, no second border.
                  </p>
                </Card>
              </Card>
            </div>
          </Specimen>
          <Specimen
            label="<CardFrame> · <CardFrameHeader> · <CardFrameFooter>"
            note="A frame around two cards"
          >
            <div className="w-full max-w-96">
              <CardFrame>
                <CardFrameHeader>
                  <CardFrameTitle>Services</CardFrameTitle>
                  <CardFrameDescription>Everything the project runs.</CardFrameDescription>
                </CardFrameHeader>
                <SampleCard />
                <SampleCard />
                <CardFrameFooter>
                  <Button size="sm" variant="ghost">
                    Add a service
                  </Button>
                </CardFrameFooter>
              </CardFrame>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "card",
  title: "Card",
  purpose: "A bounded surface for one thing: its name, facts and actions.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/card.tsx",
  render: () => <CardSpecimens />,
});
