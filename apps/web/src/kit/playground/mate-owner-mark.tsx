import { MATE_TINT_IDS } from "@t3tools/shared/brand";

import { MateOwnerMark } from "~/components/zerops/MateOwnerMark";
import { MateFace } from "~/components/zerops/primitives";
import { ownerMark } from "~/components/zerops/SidebarMateRow.logic";

import { definePlayground, jsxElement } from "../kitPlayground";
import { PICTURES, pictureOf } from "./people";

/** `person`: a colleague's Mate; `nobody`: a Mate nobody has signed in yet. */
const SEATS = ["person", "nobody"] as const;

export default definePlayground({
  section: "mate-owner-mark",
  name: "MateOwnerMark",
  imports: 'import { MateOwnerMark } from "~/components/zerops/MateOwnerMark";',
  controls: {
    seat: { kind: "enum", options: SEATS, note: "nobody: an empty, dashed seat" },
    owner: { kind: "text", note: "whose Mate it is" },
    picture: { kind: "enum", options: PICTURES, note: "their picture, or their initial" },
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "the face it is cut out of" },
  },
  initial: { seat: "person", owner: "Petra Malá", picture: "none", tint: "sky" },
  render: ({ seat, owner, picture, tint }) => (
    // The menu's row seats it so: the face cut where the mark stands, the mark on its corner.
    <span className="relative flex">
      <span className="menu-face-cut relative flex">
        <MateFace className="size-9" size={32} state="idle" tint={tint} />
      </span>
      <MateOwnerMark
        key={`${seat}-${picture}`}
        seat={
          seat === "nobody"
            ? { kind: "nobody", label: "Nobody's Mate yet" }
            : {
                kind: "person",
                mark: ownerMark({ name: owner, avatarUrl: pictureOf(picture), initials: "" }),
              }
        }
      />
    </span>
  ),
  jsx: ({ seat, owner, picture }) =>
    jsxElement(
      "MateOwnerMark",
      seat === "nobody"
        ? { 'seat={{ kind: "nobody", label: "Nobody\'s Mate yet" }}': true }
        : {
            [`seat={{ kind: "person", mark: ownerMark({ name: "${owner}", avatarUrl: ${
              picture === "none" ? "null" : "avatarUrl"
            }, initials: "" }) }}`]: true,
          },
    ),
  usage: {
    do: [
      "Seat it on the corner of a colleague's Mate's face, cut out of the face (menu-face-cut).",
      "Seat nobody on a Mate whose records name no owner: it says so in words on hover.",
      "Read the seat from ownerBadge: the viewer's own Mate wears nothing.",
    ],
    dont: [
      "Put it before a Mate's name: (face) Cleo reads as a person called Cleo.",
      "Show a spinner or a blank person while the owner is read: the seat waits empty.",
      "Lay it over the face without the cut.",
    ],
  },
});
