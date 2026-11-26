import { MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "menu",
  name: "Menu",
  imports:
    'import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";',
  controls: {
    side: { kind: "enum", options: ["bottom", "top", "right", "left"] },
    align: { kind: "enum", options: ["start", "center", "end"] },
    width: {
      kind: "enum",
      options: ["auto", "fit", "sm", "md", "lg", "anchor"],
      note: "auto for verbs; sm, md, lg hold one width",
    },
    destructive: { kind: "boolean", note: "a row that deletes" },
  },
  initial: { side: "bottom", align: "center", width: "auto", destructive: true },
  render: ({ side, align, width, destructive }) => (
    <Menu>
      <MenuTrigger render={<Button aria-label="Project menu" size="icon-md" variant="secondary" />}>
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align={align} side={side} width={width}>
        <MenuItem>
          <PencilIcon />
          Rename
        </MenuItem>
        <MenuItem>Duplicate</MenuItem>
        {destructive ? (
          <>
            <MenuSeparator />
            <MenuItem variant="destructive">
              <TrashIcon />
              Delete
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  ),
  jsx: ({ side, align, width, destructive }) =>
    jsxElement(
      "Menu",
      {},
      [
        '<MenuTrigger render={<Button aria-label="Project menu" size="icon-md" variant="secondary" />}>',
        "  <MoreHorizontalIcon />",
        "</MenuTrigger>",
        jsxElement(
          "MenuPopup",
          { side, align, width },
          [
            "<MenuItem>Rename</MenuItem>",
            "<MenuItem>Duplicate</MenuItem>",
            ...(destructive
              ? ["<MenuSeparator />", '<MenuItem variant="destructive">Delete</MenuItem>']
              : []),
          ].join("\n"),
          { side: "bottom", align: "center", width: "auto" },
        ),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Put a thing's actions and settings behind one trigger, one row each.",
      "Press the trigger to open it here.",
    ],
    dont: ["Hide the one next step in a menu: that is a primary Button."],
  },
});
