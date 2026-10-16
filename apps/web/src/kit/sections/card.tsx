import { MoreHorizontalIcon } from "lucide-react";

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
import { Specimen, SpecimenGrid } from "../Specimen";

function SampleCard({ variant }: { readonly variant?: "default" | "flat" }) {
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
        <p className="m-0 text-sm">Deployed eight minutes ago from main.</p>
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
    <SpecimenGrid>
      <Specimen label='<Card> (variant="default")'>
        <div className="w-80">
          <SampleCard />
        </div>
      </Specimen>
      <Specimen label='<Card variant="flat">'>
        <div className="w-80">
          <SampleCard variant="flat" />
        </div>
      </Specimen>
      <Specimen label="<Card> title only">
        <div className="w-80">
          <Card>
            <CardHeader>
              <CardTitle>A card with a title and nothing else</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </Specimen>
      <Specimen label="<CardFrame> around two cards">
        <div className="w-96">
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
