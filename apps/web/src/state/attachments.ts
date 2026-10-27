import { workspaceCommand } from "./workspace";
export const attachmentEnvironment = {
  createUploadUrl: workspaceCommand("mate-attachment-create-upload"),
  remove: workspaceCommand("mate-attachment-delete"),
};
