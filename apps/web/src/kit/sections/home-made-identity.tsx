import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";

import { MateMark } from "~/components/MateMark";
import { ZeropsMark } from "~/components/ZeropsMark";
import { zeropsInitials } from "~/components/zerops/landing/ZeropsAccountControl.logic";
import { MateOwnerMark } from "~/components/zerops/MateOwnerMark";
import { Avatar, MateFace } from "~/components/zerops/primitives";
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
const FACE_SIZES = ["dot", "sm", "md", "lg"] as const;
const AVATAR_SIZES = ["xs", "sm", "md", "xl"] as const;

const FACE_SOURCE = "apps/web/src/components/zerops/primitives/MateFace.tsx";
const AVATAR_SOURCE = "apps/web/src/components/zerops/primitives/Avatar.tsx";
const MARK_SOURCE = "apps/web/src/components/MateMark.tsx";
const OWNER_SOURCE = "apps/web/src/components/zerops/MateOwnerMark.tsx";

// One person, as each identity mark draws them.
const PERSON = { name: "Ada Lovelace", avatarUrl: null } as const;

/** A Mate's face with its owner's mark cut into its corner, as the menu's row seats them. */
function SeatedFace({ seat }: { readonly seat: Parameters<typeof MateOwnerMark>[0]["seat"] }) {
  return (
    <span className="relative flex">
      <span className="menu-face-cut relative flex">
        <MateFace className="size-9" size="lg" state="idle" tint="sky" />
      </span>
      <MateOwnerMark seat={seat} />
    </span>
  );
}

function IdentitySpecimens() {
  const adaInitials = zeropsInitials(PERSON.name);
  return (
    <CensusLooks>
      <CensusCount files={69} kit="the kit has no avatar or identity mark" looks={6} />
      <CensusLook
        source={FACE_SOURCE}
        files={40}
        name="MateFace"
        note="a Mate: its tint, shape and state"
        uses={59}
      >
        <SpecimenMatrix
          rowProp="tint"
          rows={MATE_TINT_IDS}
          columnProp="state"
          columns={STATES}
          render={(tint, state) => <MateFace size="md" state={state} tint={tint} />}
        />
        {FACE_SIZES.map((size) => (
          <Specimen key={size} label={specimenLabel({ size, tint: "coral", state: "idle" })}>
            <MateFace size={size} state="idle" tint="coral" />
          </Specimen>
        ))}
        {MATE_SHAPE_IDS.map((shape) => (
          <Specimen key={shape} label={specimenLabel({ shape, tint: "violet", size: "md" })}>
            <MateFace shape={shape} size="md" state="idle" tint="violet" />
          </Specimen>
        ))}
        <Specimen label={specimenLabel({ mark: true, tint: "amber", size: "md" })}>
          <MateFace mark size="md" state="idle" tint="amber" />
        </Specimen>
        <Specimen label={specimenLabel({ gaze: "up", state: "working", size: "lg" })}>
          <MateFace gaze="up" size="lg" state="working" tint="olive" />
        </Specimen>
        <Specimen label={specimenLabel({ restarting: true, size: "lg" })}>
          <MateFace restarting size="lg" state="idle" tint="rose" />
        </Specimen>
      </CensusLook>

      <CensusLook
        source={AVATAR_SOURCE}
        files={12}
        name="Avatar"
        note="a person: grey, one or two letters"
        uses={17}
      >
        {AVATAR_SIZES.map((size) => (
          <Specimen key={size} label={specimenLabel({ initials: adaInitials, size })}>
            <Avatar initials={adaInitials} size={size} />
          </Specimen>
        ))}
      </CensusLook>

      <CensusLook
        source={MARK_SOURCE}
        files={9}
        name="MateMark"
        note="the product, or one Mate in its tint"
        uses={11}
      >
        <Specimen label="(defaults)">
          <MateMark className="size-8" />
        </Specimen>
        <Specimen label={specimenLabel({ playful: true, awake: true })}>
          <MateMark awake className="size-8" playful />
        </Specimen>
        {(["working", "needs", "done", "sleep"] as const).map((state) => (
          <Specimen key={state} label={specimenLabel({ playful: true, awake: true, state })}>
            <MateMark awake className="size-8" playful state={state} />
          </Specimen>
        ))}
        {MATE_TINT_IDS.map((tint) => (
          <Specimen key={tint} label={specimenLabel({ tint })}>
            <MateMark className="size-8" tint={tint} />
          </Specimen>
        ))}
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
        source={OWNER_SOURCE}
        files={6}
        name="MateOwnerMark"
        note="a person on a Mate's corner: tinted, one letter"
        uses={7}
      >
        <Specimen label='seat={{ kind: "person" }} on a face'>
          <SeatedFace
            seat={{
              kind: "person",
              mark: ownerMark({ ...PERSON, initials: adaInitials }),
            }}
          />
        </Specimen>
        {["Bruno Diaz", "Chen Wei", "Mira"].map((name) => (
          <Specimen key={name} label={`seat of "${name}"`}>
            <SeatedFace
              seat={{
                kind: "person",
                mark: ownerMark({ name, initials: zeropsInitials(name), avatarUrl: null }),
              }}
            />
          </Specimen>
        ))}
        <Specimen label='seat={{ kind: "nobody" }}'>
          <SeatedFace seat={{ kind: "nobody", label: "Nobody's Mate yet" }} />
        </Specimen>
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

      <SpecimenBlock title={`One person, "${PERSON.name}", as the app draws them in three places`}>
        <SpecimenGrid>
          <Specimen label="Avatar: the account menu, team, usage">
            <Avatar initials={adaInitials} size="sm" />
          </Specimen>
          <Specimen label="Avatar: the overview card's people">
            <Avatar className="size-5 text-3xs" initials={adaInitials} />
          </Specimen>
          <Specimen label="MateOwnerMark: the menu, the overview's Mates">
            <SeatedFace
              seat={{ kind: "person", mark: ownerMark({ ...PERSON, initials: adaInitials }) }}
            />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </CensusLooks>
  );
}

export default defineKitSection({
  id: "home-made-identity",
  title: "Identity marks",
  purpose:
    "Who or what a thing belongs to: a Mate, a person, the product, the platform, an agent's maker. No organisation or project has a mark of its own.",
  group: "Home-made",
  kind: "Identity",
  source: "apps/web/src/components",
  render: () => <IdentitySpecimens />,
});
