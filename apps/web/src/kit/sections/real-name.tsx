import { RealName } from "~/components/ui/real-name";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function RealNameSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="A real thing's own name, in the words around it." title="In a line">
        <SpecimenGrid size="md">
          <Specimen label="<RealName>" note="A hostname in a line">
            <span className="text-body text-foreground">
              Deployed to <RealName>api</RealName> a minute ago
            </span>
          </Specimen>
          <Specimen label="<RealName>" note="A version, muted with its line">
            <span className="text-line text-muted-foreground">
              <RealName>v2.3.1</RealName> brought: gift cards at checkout
            </span>
          </Specimen>
          <Specimen label="<RealName>" note="A repository in a caption">
            <span className="text-caption text-muted-foreground">
              from <RealName>acme/store</RealName>
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "real-name",
  title: "RealName",
  purpose: "A real thing's own name in a line of words: a hostname, a slug, a version.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/real-name.tsx",
  render: () => <RealNameSpecimens />,
});
