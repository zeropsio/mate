import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { ComposerEditor as NativeComposerEditor } from "../native/T3ComposerEditor";
import type { ComposerEditorProps } from "../native/T3ComposerEditor";
import { mobilePreferencesAtom } from "../state/preferences";

/** The native editor with the user's hardware-keyboard Return preference applied. */
export function ComposerEditor(props: ComposerEditorProps) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferredEnterBehavior = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.composerEnterBehavior
    : undefined;
  return (
    <NativeComposerEditor
      {...props}
      enterBehavior={props.enterBehavior ?? preferredEnterBehavior}
    />
  );
}
export type {
  ComposerEditorHandle,
  ComposerEditorProps,
  ComposerEditorSelection,
} from "../native/T3ComposerEditor";
