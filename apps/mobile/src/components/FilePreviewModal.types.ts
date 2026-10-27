import type { AssetResource, EnvironmentId } from "@t3tools/contracts";

import type { FileBackedComposerAttachment } from "../lib/composerImages";

export interface ResolvedFilePreviewSource {
  readonly kind: "image" | "pdf";
  readonly uri: string;
  readonly name?: string;
  readonly sourceIdentifier?: string;
}

export type FilePreviewSource = Omit<ResolvedFilePreviewSource, "uri"> &
  (
    | { readonly uri: string }
    | { readonly attachment: FileBackedComposerAttachment }
    | { readonly environmentId: EnvironmentId; readonly resource: AssetResource }
  );
