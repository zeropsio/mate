import type { ComponentProps } from "react";

import { Skeleton } from "~/components/ui/skeleton";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type SkeletonShape = NonNullable<ComponentProps<typeof Skeleton>["shape"]>;
type SkeletonSurface = NonNullable<ComponentProps<typeof Skeleton>["surface"]>;

const SHAPES = variantsOf<SkeletonShape>({ block: true, pill: true, card: true });
const SURFACES = variantsOf<SkeletonSurface>({ page: true, card: true });
// A skeleton's size is the content it stands for, so each shape stands for something here: the
// JSX prints the class each branch below draws.
const SIZE = {
  block: "h-4 w-48",
  pill: "size-8",
  card: "h-24 w-48",
} as const satisfies Record<SkeletonShape, string>;

export default definePlayground({
  section: "skeleton",
  name: "Skeleton",
  imports: 'import { Skeleton } from "~/components/ui/skeleton";',
  controls: {
    shape: { kind: "enum", options: SHAPES, note: "a line of text, a face, a card" },
    surface: {
      kind: "enum",
      options: SURFACES,
      note: "what it stands on: card on a card's ground",
    },
  },
  initial: { shape: "block", surface: "page" },
  render: ({ shape, surface }) => (
    // The ground it is drawn on is the one its surface names.
    <div
      className={
        surface === "card"
          ? "flex w-64 items-center justify-center rounded-card border bg-card p-6"
          : "flex w-64 items-center justify-center p-6"
      }
    >
      {shape === "pill" ? (
        <Skeleton className="size-8" shape="pill" surface={surface} />
      ) : shape === "card" ? (
        <Skeleton className="h-24 w-48" shape="card" surface={surface} />
      ) : (
        <Skeleton className="h-4 w-48" surface={surface} />
      )}
    </div>
  ),
  jsx: ({ shape, surface }) =>
    jsxElement("Skeleton", { className: SIZE[shape], shape, surface }, undefined, {
      shape: "block",
      surface: "page",
    }),
  usage: {
    do: [
      "Size it as the content it stands for, through className: that is layout.",
      "Set surface card when it stands on a card's ground, or it vanishes in dark.",
      "Compose a surface's stand-in from it inside Loading.",
    ],
    dont: [
      "Use one alone where Loading's rows, lines or cards already match the content.",
      "Leave it painted once the content has answered, even with nothing.",
    ],
  },
});
