import { PictureFrame } from "~/components/ui/picture-frame";
import { Skeleton } from "~/components/ui/skeleton";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "picture-frame",
  name: "PictureFrame",
  imports: 'import { PictureFrame } from "~/components/ui/picture-frame";',
  controls: {
    size: {
      kind: "enum",
      options: ["card", "control"],
      note: "card: a picture in a conversation; control: a thumbnail",
    },
    tone: {
      kind: "enum",
      options: ["default", "attention", "failed"],
      note: "the edge's ink: a retried or a failed check's picture",
    },
    picture: { kind: "boolean", note: "its picture is there" },
    waiting: { kind: "boolean", note: "its picture is on its way: nothing painted" },
  },
  initial: { size: "card", tone: "default", picture: true, waiting: false },
  render: ({ size, tone, picture, waiting }) => (
    <PictureFrame className="h-36 w-64" size={size} tone={tone} waiting={waiting}>
      {picture ? (
        <span aria-hidden="true" className="flex size-full flex-col gap-1.5 bg-card p-3">
          <Skeleton className="h-2 w-2/5 shrink-0" surface="card" />
          <Skeleton className="h-1.5 w-4/5 shrink-0" surface="card" />
          <Skeleton className="mt-1 min-h-0 w-full flex-1" surface="card" />
        </span>
      ) : null}
    </PictureFrame>
  ),
  jsx: ({ size, tone, picture, waiting }) =>
    jsxElement(
      "PictureFrame",
      { size, tone, waiting },
      picture ? '<AssetImage className="block size-full object-cover" … />' : undefined,
      { size: "card", tone: "default", waiting: false },
    ),
  usage: {
    do: [
      "Frame every screenshot, sent picture and page preview with it.",
      "Put it inside the press that opens the viewer, so it never clips the press's focus ring.",
    ],
    dont: [
      "Draw a picture's corners, hairline or ground by hand.",
      "Wrap a press in it: its corners would clip the focus ring.",
    ],
  },
});
