/**
 * What the composer's editor tells a screen reader: a labelled, multi-line text box that offers
 * a list of suggestions, pointing at the option the keys are on while that list shows. Read-only
 * and offering nothing while it can't be written in. Props for Lexical's `ContentEditable`.
 */
export function composerEditorAria(input: {
  readonly ariaLabel?: string | undefined;
  /** The suggestion list's id: names an editor that offers suggestions, even while it is shut. */
  readonly suggestionListId?: string | undefined;
  /** The highlighted option's id, only while its list is drawn. */
  readonly activeSuggestionId?: string | undefined;
  readonly disabled: boolean;
}): {
  readonly role: "textbox";
  readonly ariaMultiline: true;
  readonly ariaLabel?: string;
  readonly "aria-readonly"?: true;
  readonly ariaAutoComplete?: "list";
  readonly "aria-haspopup"?: "listbox";
  readonly ariaControls?: string;
  readonly ariaActiveDescendant?: string;
} {
  const { ariaLabel, suggestionListId, activeSuggestionId, disabled } = input;
  return {
    role: "textbox",
    ariaMultiline: true,
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(disabled ? { "aria-readonly": true as const } : {}),
    ...(!disabled && suggestionListId
      ? {
          ariaAutoComplete: "list" as const,
          "aria-haspopup": "listbox" as const,
          ...(activeSuggestionId
            ? { ariaControls: suggestionListId, ariaActiveDescendant: activeSuggestionId }
            : {}),
        }
      : {}),
  };
}
