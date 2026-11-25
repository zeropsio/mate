import { PersonAvatar, type MateFaceSize } from "~/components/zerops/primitives";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";
import { PICTURES, pictureOf, pictureSource } from "./people";

// One scale with a Mate's face: PersonAvatar takes the same sizes.
const SIZES = variantsOf<`${MateFaceSize}`>({
  "16": true,
  "20": true,
  "24": true,
  "32": true,
  "64": true,
});

export default definePlayground({
  section: "person-avatar",
  name: "PersonAvatar",
  imports: 'import { PersonAvatar } from "~/components/zerops/primitives";',
  controls: {
    name: { kind: "text", note: "its first word gives the letter and the hue" },
    picture: { kind: "enum", options: PICTURES, note: "broken falls back to the letter" },
    size: { kind: "enum", options: SIZES, note: "one scale with MateFace" },
    nobody: { kind: "boolean", note: "the seat no person holds" },
  },
  initial: { name: "Petra Malá", picture: "none", size: "64", nobody: false },
  render: ({ name, picture, size, nobody }) =>
    nobody ? (
      <PersonAvatar nobody size={Number(size) as MateFaceSize} />
    ) : (
      <PersonAvatar
        key={picture}
        name={name}
        picture={pictureOf(picture)}
        size={Number(size) as MateFaceSize}
      />
    ),
  jsx: ({ name, picture, size, nobody }) => {
    if (nobody)
      return jsxElement("PersonAvatar", { nobody: true, size: Number(size) }, undefined, {
        size: 24,
      });
    const source = pictureSource(picture);
    return jsxElement(
      "PersonAvatar",
      {
        name,
        picture: source === undefined ? undefined : jsxCode(source),
        size: Number(size),
      },
      undefined,
      { size: 24 },
    );
  },
  usage: {
    do: [
      "Write the person's name beside it: the avatar is decorative and names no one by itself.",
      "Pass the name they go by; Petra and Petra Malá are the same letter and hue.",
      "Seat it at the size of the Mate faces beside it: 16 in an xs row, 20 in sm, 32 in md.",
      "Seat nobody where no person is: an automated Mate, a Mate nobody owns yet.",
      "Show who has access as a PersonAvatarStack, with the count in words beside it.",
    ],
    dont: [
      "Draw a Mate with it: a Mate is its MateFace.",
      "Pick its colour: the hue is the person's, the same on every surface.",
      "Stand a bot, a grey disc or an icon in for nobody: nobody is the dashed ring.",
      "Put it before a Mate's name to say whose it is: that is MateOwnerMark on the face's corner.",
    ],
  },
});
