import { ChevronDownIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function GroupSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Controls that act together, joined into one shape."
        title="Orientations and content"
      >
        <SpecimenGrid size="md">
          <Specimen label="<Group> · <GroupSeparator>" note="A press and its choices, side by side">
            <Group>
              <Button variant="secondary">Deploy</Button>
              <GroupSeparator />
              <Button aria-label="More deploy choices" size="icon-md" variant="secondary">
                <ChevronDownIcon />
              </Button>
            </Group>
          </Specimen>
          <Specimen label='<Group orientation="vertical">' note="Stacked">
            <Group orientation="vertical">
              <Button variant="secondary">Top</Button>
              <GroupSeparator orientation="horizontal" />
              <Button variant="secondary">Middle</Button>
              <GroupSeparator orientation="horizontal" />
              <Button variant="secondary">Bottom</Button>
            </Group>
          </Specimen>
          <Specimen label="<Group> · <Input> · <Button>" note="A field and its press">
            <Group>
              <Input aria-label="Domain" placeholder="shop.example.com" />
              <GroupSeparator />
              <Button variant="secondary">Add</Button>
            </Group>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "group",
  title: "Group",
  purpose: "Joins controls that act together into one shape.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/group.tsx",
  render: () => <GroupSpecimens />,
});
