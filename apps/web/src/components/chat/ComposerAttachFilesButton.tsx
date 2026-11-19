import { PaperclipIcon } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The way to attach where nothing is dropped or pasted, as on a phone. */
export function ComposerAttachFilesButton({
  disabled,
  pickerRef,
  onFiles,
}: {
  readonly disabled: boolean;
  readonly pickerRef: RefObject<HTMLInputElement | null>;
  readonly onFiles: (files: File[]) => void;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Attach files"
              data-chat-composer-attach=""
              disabled={disabled}
              // The caret stays where it was in the text, and a phone's composer
              // stays open under the picker.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pickerRef.current?.click()}
            >
              <PaperclipIcon aria-hidden="true" />
            </Button>
          }
        />
        <TooltipPopup side="top">Attach files or pictures</TooltipPopup>
      </Tooltip>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          // Cleared, so the same file picked again is a change again.
          event.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
