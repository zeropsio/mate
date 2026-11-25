import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import type { ComponentProps } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";
import { FaceCard, FaceCardLine, FaceCards } from "~/components/zerops/system/FaceCard";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";
import { PICTURES, pictureOf } from "./people";

type LineTone = NonNullable<ComponentProps<typeof FaceCardLine>["tone"]>;
const TONES = variantsOf<LineTone>({ muted: true, ink: true, failed: true, attention: true });
const RESTS = variantsOf<NonNullable<ComponentProps<typeof FaceCard>["rest"]>>({
  top: true,
  middle: true,
});
const FIGURES = ["person", "mate"] as const;
const LINES = ["1", "2"] as const;

export default definePlayground({
  section: "face-card",
  name: "FaceCard",
  imports:
    'import { FaceCard, FaceCardLine, FaceCards } from "~/components/zerops/system/FaceCard";',
  controls: {
    figure: { kind: "enum", options: FIGURES, note: "a person on Team, a Mate on its project" },
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "the Mate's, when the figure is one" },
    picture: { kind: "enum", options: PICTURES, note: "the person's, when the figure is one" },
    title: { kind: "text" },
    line: { kind: "text", note: "one quiet line under the title" },
    tone: { kind: "enum", options: TONES, note: "ink asks of the person; failed and attention" },
    lines: { kind: "enum", options: LINES, note: "2 keeps two lines' height whatever it holds" },
    chips: { kind: "boolean", note: "a role or state under the title" },
    stamp: { kind: "text", note: "when it last moved, in the body's corner" },
    foot: { kind: "boolean", note: "a press of the card's own, outside its body" },
    ruled: { kind: "boolean", note: "the foot under a hairline" },
    faded: { kind: "boolean", note: "an invitation not accepted yet" },
    pressable: { kind: "boolean", note: "the body opens the person's page or the Mate's chat" },
    rest: { kind: "enum", options: RESTS, note: "middle: centred in a card its row made taller" },
  },
  initial: {
    figure: "person",
    tint: "olive",
    picture: "none",
    title: "Petra Malá",
    line: "petra@example.com",
    tone: "muted",
    lines: "1",
    chips: true,
    stamp: "",
    foot: false,
    ruled: false,
    faded: false,
    pressable: false,
    rest: "top",
  },
  render: (args) => (
    <div className="w-60">
      <FaceCards label={args.figure === "mate" ? "Mates" : "People"}>
        <li className="grid">
          <FaceCard
            chips={
              args.chips ? <Badge>{args.figure === "mate" ? "Working" : "Owner"}</Badge> : undefined
            }
            faded={args.faded}
            figure={
              args.figure === "mate" ? (
                <MateFace size={64} state="working" tint={args.tint} />
              ) : (
                <PersonAvatar
                  key={args.picture}
                  name={args.title}
                  picture={pictureOf(args.picture)}
                  size={64}
                />
              )
            }
            foot={
              args.foot ? (
                <Button size="xs" variant="ghost">
                  {args.figure === "mate" ? "Open the chat" : "Send again"}
                </Button>
              ) : undefined
            }
            press={args.pressable ? <Button variant="bare" /> : undefined}
            rest={args.rest}
            ruled={args.ruled}
            stamp={args.stamp === "" ? undefined : args.stamp}
            title={args.title}
          >
            {args.line === "" ? null : (
              <FaceCardLine lines={args.lines === "2" ? 2 : 1} tone={args.tone}>
                {args.line}
              </FaceCardLine>
            )}
          </FaceCard>
        </li>
      </FaceCards>
    </div>
  ),
  jsx: (args) => {
    const figure =
      args.figure === "mate"
        ? `<MateFace size={64} state="working" tint="${args.tint}" />`
        : `<PersonAvatar name="${args.title}" size={64} />`;
    const line =
      args.line === ""
        ? undefined
        : jsxElement(
            "FaceCardLine",
            { lines: args.lines === "2" ? 2 : undefined, tone: args.tone },
            args.line,
            { tone: "muted" },
          );
    return jsxElement(
      "FaceCard",
      {
        figure: jsxCode(figure),
        title: args.title,
        chips: args.chips
          ? jsxCode(`<Badge>${args.figure === "mate" ? "Working" : "Owner"}</Badge>`)
          : undefined,
        stamp: args.stamp === "" ? undefined : args.stamp,
        foot: args.foot ? jsxCode('<Button size="xs" variant="ghost">…</Button>') : undefined,
        press: args.pressable ? jsxCode('<Button variant="bare" />') : undefined,
        ruled: args.ruled,
        faded: args.faded,
        rest: args.rest,
      },
      line,
      { ruled: false, faded: false, rest: "top" },
    );
  },
  usage: {
    do: [
      'Stand each card in FaceCards, one <li className="grid"> per card, so a row is as tall as its tallest.',
      "Lead with a 64 px face: a person's avatar or a Mate's face, never an icon.",
      "Keep the body one press; put the card's own presses in its foot.",
      "Use footHeld where a verb arrives later, so its arrival moves nothing.",
    ],
    dont: [
      "Put a press inside the body: a press in a press.",
      "Stack more than two quiet lines; what else there is goes on the page it opens.",
      "Use it for a list of services or releases: those are Rows.",
    ],
  },
});
