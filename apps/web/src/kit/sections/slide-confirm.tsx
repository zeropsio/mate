import { useState } from "react";

import { SlideConfirm } from "~/components/ui/slide-confirm";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A slide that answers the pointer and the keyboard, starting where its tile says. */
function Slide({
  initial,
  locked = false,
}: {
  readonly initial: boolean;
  readonly locked?: boolean;
}) {
  const [confirmed, setConfirmed] = useState(initial);
  return (
    <SlideConfirm
      className="w-full max-w-80"
      confirmed={confirmed}
      confirmedLabel="Stage api will be deleted"
      label="Slide to delete Stage api"
      locked={locked}
      onConfirmedChange={setConfirmed}
    />
  );
}

export default defineKitSection({
  id: "slide-confirm",
  title: "SlideConfirm",
  purpose: "A one-way confirmation, slid left to right, that something in Zerops is deleted.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/slide-confirm.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock title="States">
        <SpecimenGrid size="md">
          <Specimen label="confirmed={false}" note="Waiting to be slid">
            <Slide initial={false} />
          </Specimen>
          <Specimen label="confirmed" note="Slid to the end, with its way back">
            <Slide initial />
          </Specimen>
          <Specimen label="locked" note="A Production's slide before its name is typed">
            <Slide initial={false} locked />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
