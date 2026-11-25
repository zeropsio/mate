import { Card } from "~/components/ui/card";
import { List } from "~/components/ui/list";
import { Row } from "~/components/ui/row";
import { StepNumber } from "~/components/ui/step-number";
import { Text } from "~/components/ui/text";
import { PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const RECORDS = [
  { name: "API_TOKEN", line: "Stage and Production" },
  { name: "DATABASE_URL", line: "Production only" },
  { name: "SENTRY_DSN", line: "Every app" },
] as const;

const STOPS = [
  { title: "Your three changes", line: "Merged into main" },
  { title: "Stage", line: "Builds and deploys first" },
  { title: "Production", line: "Once Stage is running" },
] as const;

function ListSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Like things in one column, each rule spanning its item: the list draws the rules, the rows nothing at their edges."
        title="Full rules"
      >
        <SpecimenGrid size="lg">
          <Specimen label='<Card variant="flat"> · <List>' note="A card of records">
            <Card className="w-full max-w-96" variant="flat">
              <List render={<ul />}>
                {RECORDS.map((record) => (
                  <Row
                    key={record.name}
                    line={record.line}
                    render={<li />}
                    size="sm"
                    title={record.name}
                  />
                ))}
              </List>
            </Card>
          </Specimen>
          <Specimen label='<div className="px-4"> · <List>' note="Ruled to the card's padding">
            <Card className="w-full max-w-96" variant="flat">
              <div className="px-4">
                <List render={<ul />}>
                  {["Petra Malá", "Jan Svoboda"].map((name) => (
                    <li className="flex items-center justify-between gap-3 py-2.5" key={name}>
                      <Text variant="heading">{name}</Text>
                      <Text variant="meta">Developer</Text>
                    </li>
                  ))}
                </List>
              </div>
            </Card>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Each rule starts at the items' words and ends at their padding, past a 24 px mark."
        title="Inset rules"
      >
        <SpecimenGrid size="lg">
          <Specimen label='<List rule="inset">' note="A route's stops">
            <Card className="w-full max-w-96" variant="flat">
              <List render={<ol />} rule="inset">
                {STOPS.map((stop, index) => (
                  <li
                    className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4 px-4 py-3.5"
                    key={stop.title}
                  >
                    <StepNumber n={index + 1} state={index === 0 ? "done" : "todo"} />
                    <span className="grid gap-0.5">
                      <Text variant="heading">{stop.title}</Text>
                      <Text variant="description">{stop.line}</Text>
                    </span>
                  </li>
                ))}
              </List>
            </Card>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A list between other content, with no card around it." title="Edges">
        <SpecimenGrid size="lg">
          <Specimen label="<List edges>" note="Rules above the first and under the last">
            <List className="w-full max-w-96" edges render={<ul />}>
              {["Petra Malá", "Jan Svoboda"].map((name) => (
                <Row
                  key={name}
                  lead={<PersonAvatar name={name} size={32} />}
                  line="Developer"
                  render={<li />}
                  title={name}
                />
              ))}
            </List>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "list",
  title: "List",
  purpose: "Like things in one column, parted by a hairline the list draws.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/list.tsx",
  render: () => <ListSpecimens />,
});
