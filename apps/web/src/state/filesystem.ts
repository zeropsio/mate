import { workspaceQuery } from "./workspace";
export const filesystemEnvironment = { browse: workspaceQuery("filesystem") };
