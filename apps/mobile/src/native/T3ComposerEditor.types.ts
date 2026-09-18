import type { ServerProviderSkill } from "@t3tools/contracts";
import type { Ref } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

import type { ComposerEnterBehavior } from "../lib/composerEnterBehavior";

export type { ComposerEnterBehavior };

export type ComposerEditorSelection = {
  readonly start: number;
  readonly end: number;
};

export interface ComposerEditorHandle {
  focus: () => void;
  blur: () => void;
  setSelection: (selection: ComposerEditorSelection) => void;
}

export interface ComposerEditorProps {
  readonly ref?: Ref<ComposerEditorHandle>;
  readonly value: string;
  readonly skills?: ReadonlyArray<
    Pick<ServerProviderSkill, "name" | "displayName" | "shortDescription" | "description">
  >;
  readonly selection?: ComposerEditorSelection;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly editable?: boolean;
  /** Blocks user edits while preserving focus, selection, and the software keyboard on iOS. */
  readonly readOnly?: boolean;
  readonly scrollEnabled?: boolean;
  readonly autoCorrect?: boolean;
  readonly spellCheck?: boolean;
  readonly multiline?: boolean;
  readonly contentInsetVertical?: number;
  /** Android: center a single line vertically (collapsed pill); no-op on iOS. */
  readonly singleLineCentered?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly textStyle?: StyleProp<TextStyle>;
  readonly onChangeText: (value: string) => void;
  readonly onSelectionChange?: (selection: ComposerEditorSelection) => void;
  readonly onPasteImages?: (uris: ReadonlyArray<string>) => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  /**
   * Hardware-keyboard Return behavior on iOS. No-op on Android, which has no
   * hardware Return handling.
   */
  readonly enterBehavior?: ComposerEnterBehavior;
  /** Hardware keyboard submission: Command-Return, or Return when `enterBehavior` is "send". */
  readonly onSubmit?: () => void;
}
