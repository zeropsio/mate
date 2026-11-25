import type { ComponentProps } from "react";
import { BoxIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type EmptySize = NonNullable<ComponentProps<typeof Empty>["size"]>;
type EmptyMediaVariant = NonNullable<ComponentProps<typeof EmptyMedia>["variant"]>;

const SIZES = variantsOf<EmptySize>({ compact: true, default: true, hero: true });
const MEDIA = variantsOf<EmptyMediaVariant>({ default: true, icon: true });

export default definePlayground({
  section: "empty",
  name: "Empty",
  imports:
    'import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "compact in a card, hero for a whole route" },
    media: { kind: "enum", options: MEDIA, note: "icon sets the glyph on a stacked tile" },
    title: { kind: "text" },
    description: { kind: "text", note: "empty for none" },
    action: { kind: "boolean" },
  },
  initial: {
    size: "default",
    media: "icon",
    title: "No services yet",
    description: "Add one and its Mate deploys it here.",
    action: true,
  },
  render: ({ size, media, title, description, action }) => (
    <div className="flex w-110 rounded-card border">
      <Empty size={size}>
        <EmptyHeader>
          <EmptyMedia variant={media}>
            <BoxIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {description === "" ? null : <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {action ? (
          <EmptyContent>
            <Button size="sm">Add a service</Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  ),
  jsx: ({ size, media, title, description, action }) =>
    jsxElement(
      "Empty",
      { size },
      [
        jsxElement(
          "EmptyHeader",
          {},
          [
            jsxElement("EmptyMedia", { variant: media }, "<BoxIcon />", { variant: "default" }),
            `<EmptyTitle>${title}</EmptyTitle>`,
            description === "" ? "" : `<EmptyDescription>${description}</EmptyDescription>`,
          ]
            .filter((part) => part !== "")
            .join("\n"),
        ),
        action ? '<EmptyContent>\n  <Button size="sm">Add a service</Button>\n</EmptyContent>' : "",
      ]
        .filter((part) => part !== "")
        .join("\n"),
      { size: "default" },
    ),
  usage: {
    do: [
      "Build from these parts only when EmptyState's row, section and page do not fit.",
      "Keep its one action to what fills the place.",
    ],
    dont: [
      "Use it while the source has not answered: that is Loading.",
      "Put more than one action under it, or a second paragraph.",
    ],
  },
});
