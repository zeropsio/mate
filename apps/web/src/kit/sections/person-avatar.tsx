import { PersonAvatar, PersonAvatarStack } from "~/components/zerops/primitives";
import type { MateFaceSize } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES: ReadonlyArray<MateFaceSize> = [16, 20, 24, 32, 64];

// One person, as each surface names them: in full, or by the first name alone.
const PERSON = "Ada Lovelace";
const PEOPLE = ["Ada Lovelace", "Bruno Diaz", "Chen Wei", "Mira", "Petra Malá"] as const;
const TEAM = [...PEOPLE, "Rhea Novak", "Otto Hale"].map((name) => ({
  key: name,
  name,
  avatarUrl: null,
}));

function PersonAvatarSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Sizes">
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ name: PERSON, size })}>
              <PersonAvatar name={PERSON} size={size} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Their picture, or their letter on a hue of their own." title="People">
        <SpecimenGrid>
          {PEOPLE.map((name) => (
            <Specimen key={name} label={specimenLabel({ name, size: 32 })}>
              <PersonAvatar name={name} size={32} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="The seat no person holds: an automated Mate, a Mate nobody owns yet."
        title="Nobody"
      >
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ nobody: true, size })}>
              <PersonAvatar nobody size={size} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Who has access: the first few faces, each over the last, then how many more."
        title="Stack"
      >
        <SpecimenGrid size="md">
          <Specimen label="PersonAvatarStack shown={4}" note="Beside a one-line summary">
            <PersonAvatarStack people={TEAM} shown={4} />
          </Specimen>
          <Specimen label="PersonAvatarStack shown={4} size={32}" note="A card's lead">
            <PersonAvatarStack people={TEAM} shown={4} size={32} />
          </Specimen>
          <Specimen label="PersonAvatarStack shown={4} size={32}" note="Nobody more">
            <PersonAvatarStack people={TEAM.slice(0, 3)} shown={4} size={32} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note={`One person, ${PERSON}, everywhere the app draws them.`}
        title="In place"
      >
        <SpecimenGrid size="md">
          <Specimen label='name="Ada" size={32}' note="The account menu: the first name">
            <PersonAvatar name="Ada" size={32} />
          </Specimen>
          <Specimen label="size={64}" note="A team card">
            <PersonAvatar name={PERSON} size={64} />
          </Specimen>
          <Specimen label="size={20}" note="The overview card's people">
            <PersonAvatar name={PERSON} size={20} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "person-avatar",
  title: "PersonAvatar",
  purpose:
    "A person: their picture, or their letter on a hue of their own; nobody's empty seat; a stack of them.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/zerops/primitives/PersonAvatar.tsx",
  render: () => <PersonAvatarSpecimens />,
});
