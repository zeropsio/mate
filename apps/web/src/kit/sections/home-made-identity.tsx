import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";

import { MateMark } from "~/components/MateMark";
import { ZeropsMark } from "~/components/ZeropsMark";
import { MateOwnerMark } from "~/components/zerops/MateOwnerMark";
import { MateFace, PersonAvatar, type MateFaceSize } from "~/components/zerops/primitives";
import { ownerMark } from "~/components/zerops/SidebarMateRow.logic";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "~/components/usage/usageProviders";

import { CensusCount, CensusLook, CensusLooks } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const STATES = variantsOf<MateMarkState>({
  idle: true,
  working: true,
  needs: true,
  surprise: true,
  done: true,
  blink: true,
  sleep: true,
  waking: true,
  closed: true,
});
const SIZES: ReadonlyArray<MateFaceSize> = [16, 20, 24, 32, 64];

const MARK_SOURCE = "apps/web/src/components/MateMark.tsx";

// One person, as each surface names them: in full, or by the first name alone.
const PERSON = { name: "Ada Lovelace", avatarUrl: null } as const;
const PEOPLE = ["Ada Lovelace", "Bruno Diaz", "Chen Wei", "Mira", "Petra Malá"] as const;

/** A Mate's face with its owner's mark cut into its corner, as the menu's row seats them. */
function SeatedFace({ seat }: { readonly seat: Parameters<typeof MateOwnerMark>[0]["seat"] }) {
  return (
    <span className="relative flex">
      <span className="menu-face-cut relative flex">
        <MateFace className="size-9" size={32} state="idle" tint="sky" />
      </span>
      <MateOwnerMark seat={seat} />
    </span>
  );
}

function Chosen() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Chosen · MateFace: a Mate — its tint, its shape, its eyes carry its state">
        <SpecimenMatrix
          rowProp="tint"
          rows={MATE_TINT_IDS}
          columnProp="state"
          columns={STATES}
          render={(tint, state) => <MateFace size={32} state={state} tint={tint} />}
        />
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ size, tint: "coral" })}>
              <MateFace size={size} state="idle" tint="coral" />
            </Specimen>
          ))}
          {MATE_SHAPE_IDS.map((shape) => (
            <Specimen key={shape} label={specimenLabel({ shape, size: 32 })}>
              <MateFace shape={shape} size={32} state="idle" tint="violet" />
            </Specimen>
          ))}
          <Specimen label={specimenLabel({ mark: true, size: 32 })}>
            <MateFace mark size={32} state="idle" tint="amber" />
          </Specimen>
          <Specimen label={specimenLabel({ gaze: "up", state: "working", size: 64 })}>
            <MateFace gaze="up" size={64} state="working" tint="olive" />
          </Specimen>
          <Specimen label={specimenLabel({ restarting: true, size: 64 })}>
            <MateFace restarting size={64} state="idle" tint="rose" />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Chosen · PersonAvatar: a person — their picture, or their letter on their own hue">
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ name: PERSON.name, size })}>
              <PersonAvatar name={PERSON.name} size={size} />
            </Specimen>
          ))}
          {PEOPLE.map((name) => (
            <Specimen key={name} label={specimenLabel({ name, size: 32 })}>
              <PersonAvatar name={name} size={32} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title={`Chosen · one person, "${PERSON.name}", everywhere the app draws them`}>
        <SpecimenGrid>
          <Specimen label="the account menu and its foot: PersonAvatar size={32}">
            <PersonAvatar name="Ada" size={32} />
          </Specimen>
          <Specimen label="a team card: PersonAvatar size={64}">
            <PersonAvatar name={PERSON.name} size={64} />
          </Specimen>
          <Specimen label="the overview card's people: PersonAvatar size={20}">
            <PersonAvatar name={PERSON.name} size={20} />
          </Specimen>
          <Specimen label="on their Mate's face: MateOwnerMark">
            <SeatedFace seat={{ kind: "person", mark: ownerMark({ ...PERSON, initials: "" }) }} />
          </Specimen>
          <Specimen label='nobody&apos;s Mate yet: seat={{ kind: "nobody" }}'>
            <SeatedFace seat={{ kind: "nobody", label: "Nobody's Mate yet" }} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

function OtherMarks() {
  return (
    <CensusLooks>
      <CensusCount
        files={16}
        kit="MateFace and PersonAvatar (above) stand for every Mate and every person; these marks stand for something else"
        looks={3}
      />
      <CensusLook
        source={MARK_SOURCE}
        files={9}
        name="MateMark"
        note="the product's own mark, and the Chief's face"
        uses={11}
      >
        <Specimen label="(defaults)">
          <MateMark className="size-8" />
        </Specimen>
        <Specimen label={specimenLabel({ playful: true, awake: true })}>
          <MateMark awake className="size-8" playful />
        </Specimen>
      </CensusLook>
      <CensusLook
        source="apps/web/src/components/ZeropsMark.tsx"
        files={6}
        name="ZeropsMark"
        note="the platform"
        uses={7}
      >
        {(["brand", "current"] as const).map((tone) => (
          <Specimen key={tone} label={specimenLabel({ tone })}>
            <ZeropsMark className="size-8" tone={tone} />
          </Specimen>
        ))}
      </CensusLook>
      <CensusLook
        source="apps/web/src/components/usage/usageProviders.ts"
        files={1}
        name="Provider marks"
        note="an agent's maker, in usage"
        uses={2}
      >
        {PROVIDER_ORDER.map((provider) => {
          const { mark: Mark, label } = PROVIDER_PRESENTATION[provider];
          return (
            <Specimen key={provider} label={label}>
              <Mark className="size-6" />
            </Specimen>
          );
        })}
      </CensusLook>
    </CensusLooks>
  );
}

export default defineKitSection({
  id: "home-made-identity",
  title: "Identity marks",
  purpose:
    "Who or what a thing belongs to: a Mate (MateFace), a person (PersonAvatar), the product, the platform, an agent's maker. No organisation or project has a mark of its own.",
  group: "Home-made",
  kind: "Identity",
  source: "apps/web/src/components/zerops/primitives",
  render: () => (
    <div className="flex flex-col gap-10">
      <Chosen />
      <OtherMarks />
    </div>
  ),
});
