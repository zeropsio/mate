/**
 * Files in a person's message: each a quiet chip with its icon, name and size,
 * where its label stands or, when the text places it nowhere (a phone's), above
 * the words. Once the server gives a file its address the chip downloads it.
 */
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { AssetDownloadLink } from "~/assets/AssetDownloadLink";
import { useAssetUrls } from "~/assets/assetUrls";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import type { ChatAttachment } from "~/types";
import { AttachedFileFace } from "./ComposerFile";
import { formatPictureBytes } from "./ComposerPictureView";

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;

/** Each file's address, by its id: a download that carries its own name and type. */
export function useMessageFileUrls(
  environmentId: EnvironmentId,
  files: ReadonlyArray<ChatAttachment>,
): ReadonlyMap<string, string> {
  const resources = useMemo(
    () =>
      files.map((file): AttachmentResource => ({
        _tag: "attachment",
        attachmentId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
      })),
    [files],
  );
  const urls = useAssetUrls(environmentId, resources);
  return useMemo(
    () =>
      new Map(
        files.flatMap((file, index) => {
          const url = urls[index];
          return url ? [[file.id, url] as const] : [];
        }),
      ),
    [files, urls],
  );
}

/** A file in a sent message: its icon, name and size on one quiet line. */
const MESSAGE_FILE_CLASS_NAME =
  "inline-flex h-10 max-w-full items-center gap-2 rounded-control bg-foreground/5 px-3 text-inherit no-underline ring-1 ring-foreground/12";

export function MessageFile(props: { readonly file: ChatAttachment; readonly url: string | null }) {
  const { resolvedTheme } = useTheme();
  const face = (
    <AttachedFileFace
      name={props.file.name}
      detail={formatPictureBytes(props.file.sizeBytes)}
      theme={resolvedTheme}
    />
  );
  return props.url ? (
    <AssetDownloadLink
      className={cn(
        MESSAGE_FILE_CLASS_NAME,
        "hover:bg-foreground/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      source={props.url}
      download={props.file.name}
      aria-label={`Download ${props.file.name}`}
    >
      {face}
    </AssetDownloadLink>
  ) : (
    <span className={MESSAGE_FILE_CLASS_NAME}>{face}</span>
  );
}

/** The files a message's text places nowhere, above its words. */
export function MessageFilesAbove(props: {
  readonly files: ReadonlyArray<ChatAttachment>;
  readonly urls: ReadonlyMap<string, string>;
}) {
  if (props.files.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {props.files.map((file) => (
        <MessageFile key={file.id} file={file} url={props.urls.get(file.id) ?? null} />
      ))}
    </div>
  );
}
