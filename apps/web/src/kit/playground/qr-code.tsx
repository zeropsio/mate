import type { ComponentProps } from "react";

import { QRCodeSvg } from "~/components/ui/qr-code";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type QrProps = ComponentProps<typeof QRCodeSvg>;

const LEVELS = variantsOf<NonNullable<QrProps["level"]>>({ L: true, M: true, Q: true, H: true });
const SIZES = ["96", "128", "192", "256"] as const;
const MARGINS = ["0", "2", "4"] as const;

export default definePlayground({
  section: "qr-code",
  name: "QRCodeSvg",
  imports: 'import { QRCodeSvg } from "~/components/ui/qr-code";',
  controls: {
    value: { kind: "text", note: "the address a phone camera opens" },
    level: {
      kind: "enum",
      options: LEVELS,
      note: "error correction: H survives a smudge, draws denser",
    },
    size: { kind: "enum", options: SIZES, note: "px" },
    marginSize: { kind: "enum", options: MARGINS, note: "quiet modules round it" },
    title: { kind: "text", note: "its accessible name" },
  },
  initial: {
    value: "https://mate.zerops.io/",
    level: "L",
    size: "128",
    marginSize: "0",
    title: "Open Mate on your phone",
  },
  render: ({ value, level, size, marginSize, title }) => (
    <QRCodeSvg
      level={level}
      marginSize={Number(marginSize)}
      size={Number(size)}
      title={title}
      value={value}
    />
  ),
  jsx: ({ value, level, size, marginSize, title }) =>
    jsxElement(
      "QRCodeSvg",
      { value, level, size: Number(size), marginSize: Number(marginSize), title },
      undefined,
      { level: "L", size: 128, marginSize: 0 },
    ),
  usage: {
    do: [
      "Offer an address to open on a phone: signing in on another device, a preview.",
      "Write the address beside it too, for a person who cannot scan.",
      "Give it a title: it is the code's accessible name.",
    ],
    dont: [
      "Recolour it: a camera reads dark modules on a light ground, in both themes.",
      "Encode a secret a passer-by could photograph.",
    ],
  },
});
