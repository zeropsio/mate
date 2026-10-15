import type { ComponentProps } from "react";

import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

type SpinnerSize = NonNullable<ComponentProps<typeof Spinner>["size"]>;
type SpinnerTone = NonNullable<ComponentProps<typeof Spinner>["tone"]>;

const SIZES = variantsOf<SpinnerSize>({ xs: true, sm: true, md: true, lg: true });
const TONES = variantsOf<SpinnerTone>({ current: true, muted: true });

export default defineKitSection({
  id: "spinner",
  title: "Spinner",
  purpose: "Work in progress with no known end; inside a Button it takes the button's size.",
  group: "Kit",
  kind: "Feedback",
  source: "apps/web/src/components/ui/spinner.tsx",
  render: () => (
    <SpecimenMatrix
      rowProp="tone"
      rows={TONES}
      columnProp="size"
      columns={SIZES}
      render={(tone, size) => <Spinner size={size} tone={tone} />}
    />
  ),
});
