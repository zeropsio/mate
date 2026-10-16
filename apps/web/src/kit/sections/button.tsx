import { ArrowRightIcon, PlusIcon } from "lucide-react";

import { Button, InlineButton, type ButtonSize, type ButtonVariant } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<ButtonVariant>({
  primary: true,
  secondary: true,
  ghost: true,
  destructive: true,
  link: true,
});

const SIZES = variantsOf<ButtonSize>({
  sm: true,
  md: true,
  lg: true,
  "icon-sm": true,
  "icon-md": true,
});

const TEXT_SIZES = SIZES.filter((size) => !size.startsWith("icon"));
const ICON_SIZES = SIZES.filter((size) => size.startsWith("icon"));

const INLINE_TONES = ["default", "muted", "destructive", "picker"] as const;

function ButtonSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="One next step, the rest beside it">
        <SpecimenGrid>
          <Specimen label="a dialog's footer: secondary, then primary">
            <div className="flex items-center gap-2">
              <Button variant="secondary">Cancel</Button>
              <Button>Create project</Button>
            </div>
          </Specimen>
          <Specimen label="a dense row: ghost tool, sm secondary">
            <div className="flex items-center gap-1">
              <Button aria-label="Add" size="icon-sm" variant="ghost">
                <PlusIcon />
              </Button>
              <Button size="sm" variant="secondary">
                Open
              </Button>
            </div>
          </Specimen>
          <Specimen label="a page's one hero action: lg">
            <Button size="lg">Set up HQ</Button>
          </Specimen>
          <Specimen label="what deletes: destructive, beside its way out">
            <div className="flex items-center gap-2">
              <Button variant="secondary">Keep it</Button>
              <Button variant="destructive">Delete Fen</Button>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
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
            <Button variant="secondary">
              Continue
              <ArrowRightIcon />
            </Button>
          </Specimen>
          <Specimen label="long text in a 160px box">
            <div className="flex w-40">
              <Button variant="secondary">Deploy the storefront to every preview</Button>
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
  purpose:
    "The one action: primary for the single next step, secondary beside it, ghost for quiet tools, destructive only for what deletes, link inside text. A rectangle on the control radius; md by default, sm in dense rows, lg for a page's one hero action.",
  group: "Chosen",
  kind: "Actions",
  source: "apps/web/src/components/ui/button.tsx",
  render: () => <ButtonSpecimens />,
});
