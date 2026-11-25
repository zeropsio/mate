import { PaperclipIcon } from "lucide-react";

import { Overlay } from "../ui/overlay";

/** Files dragged over the conversation: it takes them as attachments. */
export function WorkspaceFileDropOverlay({ shown }: { readonly shown: boolean }) {
  return (
    <Overlay icon={<PaperclipIcon aria-hidden="true" />} kind="drop" shown={shown}>
      Drop files to attach
    </Overlay>
  );
}
