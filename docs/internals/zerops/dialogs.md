# Web dialog ownership and dismissal

An opening belongs to a person or a fresh request. Its data projection supplies content, not an
instruction to keep it open. A controlled `Dialog` requires `onOpenChange`; that owner must accept
X, Escape and outside dismissal even while an accepted operation runs. Dismissal does not cancel
that operation. Submit remains guarded against a second write.

`useProjectDialog` uses `useDialogState` to scope asynchronous replies to the opening that started
them. Closing, losing access, or opening another dialog invalidates those replies. A late response
cannot resurrect a dismissed dialog or close a newer one. HQ updates retain their running panel
while hidden, so reopening shows the original operation rather than submitting it again.

## Inventory

These are the web roots, including wrappers around the primitive. Normal dialogs have X, Escape
and outside dismissal; alert confirmations have X and Escape, and intentionally require an explicit
answer rather than dismissing on outside click.

| Family                     | Dialogs and owners                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person-owned local state   | `GitActionsControl` publish, commit, default-branch action; `PullRequestThreadDialog`; `ProjectScriptEditorDialog`; `ProposedPlanCard` save; `SettingsPanels` background activity; `UsagePriceOverrides` model prices; `ThemeImportDialog`; `AddProviderInstanceDialog`; `AddUsageLimitSourceDialog` |
| Agent sign-in              | `ZeropsAgentSignInDialog`, owned by `useZeropsAgentSignInDialog` (chat, model picker, crew) and `ZeropsPanel` (agent and login actions)                                                                                                                                                              |
| Account/project operations | `ZeropsAssignMateDialog`, `ZeropsChangeFaceDialog`, `ZeropsDeleteMateDialog`, `ZeropsMoveToGroupDialog`, `ZeropsRestartMateDialog`, `ZeropsRenameDialog` (Mate and project), `ZeropsDeleteProjectDialog`, `ZeropsAskDialog`, `ZeropsSetUpMateDialog`, `ZeropsBuildLog`, `CrewRunDialog`              |
| Creation                   | `ZeropsEnvironmentCreationDialog`, `ZeropsNewProjectDialog`, and `ZeropsNewProjectHost` organization scope                                                                                                                                                                                           |
| Update progress            | `ZeropsHqUpdate`                                                                                                                                                                                                                                                                                     |
| Request-owned hosts        | `ConfirmDialogHost` (including Mate update requests), `CustomSnoozeDialogHost`                                                                                                                                                                                                                       |
| Local alert confirmations  | `ChatView` branch restore and checkpoint revert; `projectScriptEditor` delete; `SettingsPanels` token streaming; `ThemeSettings` theme removal; `ThemeSearchSection` theme update; `UsageProviderSettings` source removal; `UsageLimits` source confirmation                                         |
| Commands                   | `CommandPalette` (also hosts `ProjectContentSearchDialog`), `ProjectFaviconPickerDialog`                                                                                                                                                                                                             |
| Review                     | `ZeropsReviewDialog` / `ZeropsReviewProvider`, and `ReviewDescription` picture viewer use Base UI directly; their close controls update their owners. Escape first dismisses a nested review interaction when it owns that key. The lazy review body also offers X while loading.                    |
| Pictures                   | `ExpandedImageDialog` and `ComposerPictureView` use custom portals, explicit X and Escape. The expanded image dismisses on its backdrop; the full-screen composer picture editor has no outside region. Escape first exits its active edit mode.                                                     |
| Theme editor               | `ThemeEditorHost` / `ThemeEditorPanel` is a persistent, nonmodal workspace with X and Escape. Outside clicks deliberately allow working in the underlying app. Its lazy loading placeholder has X and Escape and belongs to the same session.                                                        |
| Navigation sheets          | `RightPanelSheet` and responsive `ui/sidebar` use `Sheet`, with Escape/outside and their navigation toggle as the exit.                                                                                                                                                                              |
| Design/fixture openings    | Arrival, new Mate, new project, delete Mate, change face, review, sidebar commands, result pictures, and platform-layer fixtures own dismissal. Arrival uses an uncontrolled opening keyed by fixture identity; clock/content rerenders do not reopen it.                                            |

## Behaviour coverage

The primitive tests cover controlled, uncontrolled and command openings, X/Escape/outside, a
content rerender, and explicit reopening. Request-host tests require a negative answer on dismissal
and a fresh request before reopening; destructive outside clicks retain the question. Sign-in tests
exercise its production owner. Operation tests cover dismissal while pending for hand-over, face,
Mate deletion, restart, move, project deletion and project rename. Pull-request preparation tests cover dismissal while pending. Theme-editor tests cover its nonmodal session and nested Escape ownership. HQ update tests cover continued
progress after dismissal and a guarded reopen. Mate action tests settle deferred saves and deletion
after closing, including a newer opening, to protect against late response resurrection.

Mobile later: native mobile keeps its current path. Desktop consumes the web components; no native
mobile, provider or wire-contract changes are needed for this web dismissal model.
