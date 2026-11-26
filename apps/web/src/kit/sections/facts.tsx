import { Card } from "~/components/ui/card";
import { Fact, Facts } from "~/components/ui/facts";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function FactsSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Each label beside its value, the labels one column as wide as the widest."
        title="Forms"
      >
        <SpecimenGrid size="md">
          <Specimen align="start" label="<Facts>" note="What a picture carries">
            <Facts>
              <Fact label="Size">1440 × 900</Fact>
              <Fact label="Taken">Today, 14:02</Fact>
            </Facts>
          </Specimen>
          <Specimen align="start" label="<Facts mono>" note="Literals: an address, a type">
            <Facts mono>
              <Fact label="runs">npx -y @acme/mcp-server</Fact>
              <Fact label="signs in">github.com</Fact>
            </Facts>
          </Specimen>
          <Specimen
            align="start"
            label='<Card variant="inset"> · <Facts mono> · was'
            note="A change set into a card: the old value struck through"
          >
            <Card className="w-full" size="sm" variant="inset">
              <Facts mono>
                <Fact label="api · type">nodejs@22</Fact>
                <Fact label="api · min RAM" was="0.25 GB">
                  1 GB
                </Fact>
              </Facts>
            </Card>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "facts",
  title: "Facts",
  purpose: "Facts about one thing, each label beside its value; a changed one as was → now.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/facts.tsx",
  render: () => <FactsSpecimens />,
});
