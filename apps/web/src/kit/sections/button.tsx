import {
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  PlusIcon,
  SearchIcon,
  ShuffleIcon,
  XIcon,
} from "lucide-react";

import { Button, InlineButton, type ButtonSize, type ButtonVariant } from "~/components/ui/button";
import { Group } from "~/components/ui/group";
import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<ButtonVariant>({
  primary: true,
  secondary: true,
  ghost: true,
  "ghost-muted": true,
  destructive: true,
  link: true,
  "destructive-ghost": true,
  sidebar: true,
  send: true,
  scrim: true,
  warning: true,
  bare: true,
});

/** Drawn on a ground of their own (`scrim` on the picture stage) or by their content (`bare`). */
const MATRIX_VARIANTS = VARIANTS.filter((variant) => variant !== "scrim" && variant !== "bare");

const SIZES = variantsOf<ButtonSize>({
  "2xs": true,
  xs: true,
  sm: true,
  md: true,
  lg: true,
  "icon-2xs": true,
  "icon-xs": true,
  "icon-sm": true,
  "icon-md": true,
});

const TEXT_SIZES = SIZES.filter((size) => !size.startsWith("icon"));
const ICON_SIZES = SIZES.filter((size) => size.startsWith("icon"));

const INLINE_TONES = ["default", "muted", "plain", "destructive", "picker"] as const;

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
          <Specimen label="round: the composer's send, a pill under a name">
            <div className="flex items-center gap-2">
              <Button aria-label="Send" shape="round" size="icon-md">
                <ArrowUpIcon />
              </Button>
              <Button shape="round" size="sm" variant="secondary">
                <ShuffleIcon />
                Shuffle
              </Button>
            </div>
          </Specimen>
          <Specimen label="the menu's top row: sidebar, on the menu's ground">
            <div className="flex items-center gap-1 rounded-card bg-sidebar p-2">
              <Button aria-label="Search" size="icon-md" variant="sidebar">
                <SearchIcon />
              </Button>
              <Button aria-label="New Mate" size="icon-md" variant="sidebar">
                <PlusIcon />
              </Button>
            </div>
          </Specimen>
          <Specimen label="what deletes: destructive, beside its way out">
            <div className="flex items-center gap-2">
              <Button variant="secondary">Keep it</Button>
              <Button variant="destructive">Delete Fen</Button>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Composer, picture and count presses">
        <SpecimenGrid>
          <Specimen label="send: the composer's send, held, and its pills">
            <div className="flex items-center gap-2">
              <Button aria-label="Send" shape="round" size="icon-md" variant="send">
                <ArrowUpIcon />
              </Button>
              <Button aria-label="Send" disabled shape="round" size="icon-md" variant="send">
                <ArrowUpIcon />
              </Button>
              <Button shape="round" variant="send">
                Refine
              </Button>
              <Group>
                <Button shape="round" variant="send">
                  Implement
                </Button>
                <Button
                  aria-label="Implementation actions"
                  shape="round"
                  size="icon-md"
                  variant="send"
                >
                  <ChevronDownIcon />
                </Button>
              </Group>
            </div>
          </Specimen>
          <Specimen label="scrim: on a picture's dark stage">
            <div className="flex items-center gap-2 rounded-card bg-stage p-3">
              <Button aria-label="The picture before" size="icon-md" variant="scrim">
                <ChevronLeftIcon />
              </Button>
              <Button aria-label="The picture after" size="icon-md" variant="scrim">
                <ChevronRightIcon />
              </Button>
              <Button aria-label="Close picture" data-pressed="" size="icon-md" variant="scrim">
                <XIcon />
              </Button>
            </div>
          </Specimen>
          <Specimen label="warning, round: a count that opens what waits (2xs on a tile, sm in a row)">
            <div className="flex items-center gap-3">
              <Button aria-label="3 waiting on you" shape="round" size="2xs" variant="warning">
                3
              </Button>
              <Button aria-label="12 waiting on you" shape="round" size="2xs" variant="warning">
                12
              </Button>
              <Button aria-label="2 waiting on you" shape="round" size="sm" variant="warning">
                2
              </Button>
              <Button
                aria-label="2 waiting on you"
                data-pressed=""
                shape="round"
                size="sm"
                variant="warning"
              >
                2
              </Button>
            </div>
          </Specimen>
          <Specimen label="bare: a press whose picture or tile is its look">
            <div className="flex items-center gap-3">
              <Button aria-label="Open the screenshot" className="cursor-zoom-in" variant="bare">
                <span className="flex h-20 w-32 items-center justify-center overflow-hidden rounded-control border border-border/60 bg-card text-muted-foreground">
                  <ImageIcon className="size-6" />
                </span>
              </Button>
              <Button className="block aspect-square w-28" variant="bare">
                <span className="flex size-full flex-col items-center justify-center gap-2 rounded-control border border-border bg-muted p-3 text-center text-caption font-medium transition-colors hover:bg-accent/60">
                  <ImageIcon className="size-6" />A design
                </span>
              </Button>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Variants × text sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={MATRIX_VARIANTS}
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
          rows={MATRIX_VARIANTS}
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
          rows={MATRIX_VARIANTS}
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
              <span className="text-body">
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
    "The one action: primary for the single next step, secondary beside it, ghost for quiet tools, destructive only for what deletes, link inside text; send in the composer's ink, scrim on a picture's stage, warning for a count that opens what waits, bare around a picture or tile. A rectangle on the control radius; md by default, sm in dense rows, lg for a page's one hero action.",
  group: "Chosen",
  kind: "Actions",
  source: "apps/web/src/components/ui/button.tsx",
  render: () => <ButtonSpecimens />,
});
