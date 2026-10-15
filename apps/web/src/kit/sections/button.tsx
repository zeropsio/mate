import { ArrowRightIcon, PlusIcon } from "lucide-react";

import { Button, InlineButton, type ButtonSize, type ButtonVariant } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<ButtonVariant>({
  default: true,
  destructive: true,
  "destructive-outline": true,
  ghost: true,
  "ghost-muted": true,
  "ghost-primary": true,
  "ghost-destructive": true,
  glass: true,
  link: true,
  outline: true,
  "warning-outline": true,
  secondary: true,
  pill: true,
});

const SIZES = variantsOf<ButtonSize>({
  xs: true,
  sm: true,
  default: true,
  lg: true,
  xl: true,
  compact: true,
  micro: true,
  "sm-multiline": true,
  icon: true,
  "icon-xs": true,
  "icon-sm": true,
  "icon-lg": true,
  "icon-xl": true,
  "icon-micro": true,
});

const TEXT_SIZES = SIZES.filter((size) => !size.startsWith("icon"));
const ICON_SIZES = SIZES.filter((size) => size.startsWith("icon"));

const INLINE_TONES = ["default", "muted", "destructive", "picker"] as const;

function ButtonSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Variants × text sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="size"
          columns={TEXT_SIZES}
          render={(variant, size) => (
            <Button size={size} variant={variant}>
              Deploy
            </Button>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="Variants × icon sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="size"
          columns={ICON_SIZES}
          render={(variant, size) => (
            <Button aria-label="Add" size={size} variant={variant}>
              <PlusIcon />
            </Button>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="States, per variant (data-pressed is the hover look)">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="state"
          columns={["rest", "data-pressed", "disabled", "aria-disabled", "loading"] as const}
          render={(variant, state) => {
            if (state === "loading") {
              return (
                <Button disabled variant={variant}>
                  <Spinner />
                  Deploying
                </Button>
              );
            }
            return (
              <Button
                aria-disabled={state === "aria-disabled" || undefined}
                data-pressed={state === "data-pressed" ? "" : undefined}
                disabled={state === "disabled"}
                variant={variant}
              >
                Deploy
              </Button>
            );
          }}
        />
      </SpecimenBlock>
      <SpecimenBlock title="With icons, long text">
        <SpecimenGrid>
          <Specimen label="leading icon">
            <Button>
              <PlusIcon />
              New project
            </Button>
          </Specimen>
          <Specimen label="trailing icon">
            <Button variant="outline">
              Continue
              <ArrowRightIcon />
            </Button>
          </Specimen>
          <Specimen label="long text in a 160px box">
            <div className="flex w-40">
              <Button variant="outline">Deploy the storefront to every preview</Button>
            </div>
          </Specimen>
          <Specimen label='size="sm-multiline" in a 160px box'>
            <div className="flex w-40">
              <Button size="md" variant="outline">
                Deploy the storefront to every preview
              </Button>
            </div>
          </Specimen>
          <Specimen label='render={<a href="#button" />}'>
            <Button render={<a href="#button" />} variant="link">
              A link that looks like a button
            </Button>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="InlineButton, inside a sentence">
        <SpecimenGrid>
          {INLINE_TONES.map((tone) => (
            <Specimen key={tone} label={`<InlineButton ${specimenLabel({ tone })}>`}>
              <span className="text-sm">
                Changes wait for review. <InlineButton tone={tone}>Open them</InlineButton>
              </span>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "button",
  title: "Button",
  purpose: "A press that acts; its variant says how loud, its size how dense.",
  group: "Kit",
  kind: "Actions",
  source: "apps/web/src/components/ui/button.tsx",
  render: () => <ButtonSpecimens />,
});
