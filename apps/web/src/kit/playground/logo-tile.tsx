import { ClaudeAI, OpenAI, OpenCodeIcon } from "~/components/Icons";
import { LogoTile } from "~/components/ui/logo-tile";

import { definePlayground, jsxElement } from "../kitPlayground";

const LOGOS = { Claude: ClaudeAI, Codex: OpenAI, OpenCode: OpenCodeIcon } as const;
const NAMES = ["Claude", "Codex", "OpenCode"] as const;
const LOGO_SOURCE = {
  Claude: "<ClaudeAI />",
  Codex: "<OpenAI />",
  OpenCode: "<OpenCodeIcon />",
} as const;

export default definePlayground({
  section: "logo-tile",
  name: "LogoTile",
  imports: 'import { LogoTile } from "~/components/ui/logo-tile";',
  controls: {
    size: {
      kind: "enum",
      options: ["md", "lg", "sm"],
      note: "lg a picker's start, md a card's, sm a compact line",
    },
    logo: { kind: "enum", options: NAMES },
    name: { kind: "boolean", note: "the product's name beside it" },
  },
  initial: { size: "md", logo: "Claude", name: true },
  render: ({ size, logo, name }) => {
    const Logo = LOGOS[logo];
    return (
      <span className="flex items-center gap-3 text-body font-medium text-foreground">
        <LogoTile size={size}>
          <Logo />
        </LogoTile>
        {name ? logo : null}
      </span>
    );
  },
  jsx: ({ size, logo }) => jsxElement("LogoTile", { size }, LOGO_SOURCE[logo], { size: "md" }),
  usage: {
    do: [
      "Lead a product's name with its logo: an agent in a picker, a card or a line.",
      "Let the tile size the logo: leave the logo without a size of its own.",
    ],
    dont: ["Put a person's or a Mate's face on it: that is PersonAvatar or MateFace."],
  },
});
