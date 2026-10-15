import type { ComponentProps } from "react";
import { CircleCheckIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;
type BadgeSize = NonNullable<ComponentProps<typeof Badge>["size"]>;

const VARIANTS = variantsOf<BadgeVariant>({
  default: true,
  chip: true,
  destructive: true,
  error: true,
  info: true,
  outline: true,
  secondary: true,
  success: true,
  warning: true,
});
const SIZES = variantsOf<BadgeSize>({ sm: true, default: true, lg: true });

function BadgeSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Variants × sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="size"
          columns={SIZES}
          render={(variant, size) => (
            <Badge size={size} variant={variant}>
              Running
            </Badge>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="With icon, count, long text, as a link">
        <SpecimenGrid>
          <Specimen label='variant="success" + icon'>
            <Badge variant="success">
              <CircleCheckIcon />
              Running
            </Badge>
          </Specimen>
          <Specimen label='variant="secondary" (count)'>
            <Badge variant="secondary">12</Badge>
          </Specimen>
          <Specimen label='variant="outline" in a 128px box'>
            <div className="flex w-32">
              <Badge variant="outline">storefront-preview-eu-central-2</Badge>
            </div>
          </Specimen>
          <Specimen label='variant="chip" render={<a href="#badge" />}'>
            <Badge render={<a href="#badge" />} variant="chip">
              storefront
            </Badge>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "badge",
  title: "Badge",
  purpose: "A short word or count beside the thing it describes.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/badge.tsx",
  render: () => <BadgeSpecimens />,
});
