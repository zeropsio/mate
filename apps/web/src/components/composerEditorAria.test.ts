import { describe, expect, it } from "vite-plus/test";

import { composerEditorAria } from "./composerEditorAria";

describe("composerEditorAria", () => {
  it("is a labelled, multi-line text box that offers a list of suggestions", () => {
    expect(
      composerEditorAria({
        ariaLabel: "Message",
        suggestionListId: "c1-suggestions",
        disabled: false,
      }),
    ).toEqual({
      role: "textbox",
      ariaMultiline: true,
      ariaLabel: "Message",
      ariaAutoComplete: "list",
      "aria-haspopup": "listbox",
    });
  });

  it("points a screen reader at the option the keys are on, while its list shows", () => {
    expect(
      composerEditorAria({
        ariaLabel: "Message",
        suggestionListId: "c1-suggestions",
        activeSuggestionId: "c1-suggestions-%22a%22",
        disabled: false,
      }),
    ).toMatchObject({
      ariaControls: "c1-suggestions",
      ariaActiveDescendant: "c1-suggestions-%22a%22",
    });
  });

  it("offers nothing and reads as read-only while it can't be written in", () => {
    expect(
      composerEditorAria({
        ariaLabel: "Message",
        suggestionListId: "c1-suggestions",
        activeSuggestionId: "c1-suggestions-%22a%22",
        disabled: true,
      }),
    ).toEqual({
      role: "textbox",
      ariaMultiline: true,
      ariaLabel: "Message",
      "aria-readonly": true,
    });
  });
});
