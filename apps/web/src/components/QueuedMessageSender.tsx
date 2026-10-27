import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUploads,
  startAttachmentUpload,
  startFileUpload,
} from "../lib/attachmentUploadQueue";
import { newCommandId, newMessageId } from "../lib/utils";
import { useQueuedMessageStore, useQueuedMessages } from "../queuedMessageStore";
import { readThread, useThread, useThreadStatus } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useMateCommand } from "../zerops/accountEnvironments";
import { crewCommands } from "../zerops/crew/crewCommands";
import { useSendTurnReceipts } from "../zerops/sentAsk";
import { readFileAsDataUrl } from "./ChatView.logic";
import {
  backgroundQueuedMessageDue,
  sendQueuedMessageInBackground,
  type BackgroundQueuedSendDeps,
} from "./chat/queuedMessageSender.logic";

/**
 * Sends the queued messages of every conversation that is not on screen when they are due, so a
 * follow-up queued before switching to another Mate leaves on its own. An open conversation
 * sends its own queue. Mounted once at the root.
 */
export function QueuedMessageSender() {
  const threadKeys = useQueuedMessageStore(
    useShallow((state) =>
      Object.keys(state.queuesByThreadKey).filter((key) => !state.openThreadKeys[key]),
    ),
  );
  return threadKeys.map((threadKey) => <ThreadQueueSender key={threadKey} threadKey={threadKey} />);
}

/** Watches one conversation's queue; reading its thread keeps it subscribed while elsewhere. */
function ThreadQueueSender({ threadKey }: { threadKey: string }) {
  const threadRef = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  return threadRef === null ? null : (
    <ThreadQueueSenderFor threadKey={threadKey} threadRef={threadRef} />
  );
}

function ThreadQueueSenderFor({
  threadKey,
  threadRef,
}: {
  threadKey: string;
  threadRef: ScopedThreadRef;
}) {
  const thread = useThread(threadRef);
  const threadStatus = useThreadStatus(threadRef);
  const environment = useEnvironment(threadRef.environmentId);
  const queue = useQueuedMessages(threadKey);
  const open = useQueuedMessageStore((state) => Boolean(state.openThreadKeys[threadKey]));
  const send = useQueuedMessageStore((state) => state.queuedSendByThreadKey[threadKey]);
  const pendingRequest = useMemo(() => {
    const pending = derivePendingRequests(thread?.activities ?? []);
    return pending.approvals.length > 0 || pending.userInputs.length > 0;
  }, [thread?.activities]);

  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, { reportFailure: false });
  const setInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const startTurn = useMateCommand(threadEnvironment.startTurn, { reportFailure: false });
  const sendCrew = useAtomCommand(crewCommands.command, { reportFailure: false });
  const receipts = useSendTurnReceipts();

  const supportsAttachmentUploads =
    environment?.serverConfig?.environment.capabilities.attachmentUploads === true;
  const environmentId = threadRef.environmentId;
  const deps = useMemo<BackgroundQueuedSendDeps>(
    () => ({
      readThread: () => readThread(threadRef),
      supportsAttachmentUploads,
      uploads: {
        start: (images, files) => {
          for (const image of images) startAttachmentUpload({ environmentId, image });
          for (const file of files) startFileUpload({ environmentId, file });
        },
        settle: (ids) => awaitAttachmentUploads(ids),
        uploaded: (images, files) => getUploadedAttachments({ environmentId, images, files }),
        release: (images, files) => {
          if (!supportsAttachmentUploads) return;
          releaseAttachmentUploads(images);
          releaseAttachmentUploads(files);
        },
      },
      readDataUrl: readFileAsDataUrl,
      updateMetadata: (input) => updateMetadata({ environmentId, input }),
      setRuntimeMode: (input) => setRuntimeMode({ environmentId, input }),
      setInteractionMode: (input) => setInteractionMode({ environmentId, input }),
      startTurn: (input) => startTurn({ environmentId, input }),
      sendCrew: (input) => sendCrew({ environmentId, input }),
      mintIds: () => ({ commandId: newCommandId(), messageId: newMessageId() }),
      receipts,
    }),
    [
      environmentId,
      receipts,
      sendCrew,
      setInteractionMode,
      setRuntimeMode,
      startTurn,
      supportsAttachmentUploads,
      threadRef,
      updateMetadata,
    ],
  );

  const next = queue[0];
  const due = backgroundQueuedMessageDue({
    next,
    open,
    thread,
    threadLive: threadStatus === "live",
    connected: environment !== null && environment.connection.phase === "connected",
    serverConfigKnown: environment?.serverConfig != null,
    pendingRequest,
    send,
  });
  const nextId = next?.id;
  useEffect(() => {
    if (!due || nextId === undefined) return;
    void sendQueuedMessageInBackground(threadKey, nextId, deps);
  }, [deps, due, nextId, threadKey]);
  return null;
}
