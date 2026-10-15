import { ChevronDownIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function GroupSpecimens() {
  return (
    <SpecimenGrid>
      <Specimen label='<Group> (orientation="horizontal")'>
        <Group>
          <Button variant="outline">Deploy</Button>
          <GroupSeparator />
          <Button aria-label="More deploy choices" size="icon" variant="outline">
            <ChevronDownIcon />
          </Button>
        </Group>
      </Specimen>
      <Specimen label='<Group orientation="vertical">'>
        <Group orientation="vertical">
          <Button variant="outline">Top</Button>
          <GroupSeparator orientation="horizontal" />
          <Button variant="outline">Middle</Button>
          <GroupSeparator orientation="horizontal" />
          <Button variant="outline">Bottom</Button>
        </Group>
      </Specimen>
      <Specimen label="<Group> input + button">
        <Group>
          <Input aria-label="Domain" placeholder="shop.example.com" />
          <GroupSeparator />
          <Button variant="outline">Add</Button>
        </Group>
      </Specimen>
    </SpecimenGrid>
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
