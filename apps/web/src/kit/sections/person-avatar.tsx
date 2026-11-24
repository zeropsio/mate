import { PersonAvatar } from "~/components/zerops/primitives";
import type { MateFaceSize } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES: ReadonlyArray<MateFaceSize> = [16, 20, 24, 32, 64];

// One person, as each surface names them: in full, or by the first name alone.
const PERSON = "Ada Lovelace";
const PEOPLE = ["Ada Lovelace", "Bruno Diaz", "Chen Wei", "Mira", "Petra Malá"] as const;

function PersonAvatarSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Sizes and people: their picture, or their letter on their own hue">
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ name: PERSON, size })}>
              <PersonAvatar name={PERSON} size={size} />
            </Specimen>
          ))}
          {PEOPLE.map((name) => (
            <Specimen key={name} label={specimenLabel({ name, size: 32 })}>
              <PersonAvatar name={name} size={32} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title={`One person, "${PERSON}", everywhere the app draws them`}>
        <SpecimenGrid>
          <Specimen label="the account menu and its foot: size={32}, the first name">
            <PersonAvatar name="Ada" size={32} />
          </Specimen>
          <Specimen label="a team card: size={64}">
            <PersonAvatar name={PERSON} size={64} />
          </Specimen>
          <Specimen label="the overview card's people: size={20}">
            <PersonAvatar name={PERSON} size={20} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "person-avatar",
  title: "PersonAvatar",
  purpose: "A person: their picture, or their letter on a hue of their own.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/zerops/primitives/PersonAvatar.tsx",
  render: () => <PersonAvatarSpecimens />,
});
