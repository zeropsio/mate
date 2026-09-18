# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On web and desktop, HEIC and HEIF photos are automatically converted to JPEG when you drag them into
the composer or paste them into a message.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers the last provider, model, and model options you selected and reuses that
selection for new threads. A model configured in a project's settings overrides the remembered
selection for that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in T3 Code.
T3 Code only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

In a thread with prior conversation context, send `/compact` to reduce context usage. Web and
desktop also offer this action from the context meter, and the work log records token counts when
the provider reports them.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

A skill token runs the skill wherever it sits in your message. T3 Code sends it to each provider in
the form that provider runs, so the text before and after the token is kept. Skills that only you may
start, and never the agent on its own, work the same way. A skill you switched off in the provider's
settings does not appear in either menu.

Provider commands such as `/compact` only run when they open the message, so the `/` menu offers
them only there. T3 Code's own commands, such as `/model` and `/plan`, and skills stay available on
any line.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.

## Rewind to an earlier prompt

On web and desktop, choose **Revert to this message** beneath a sent message to rewind the
conversation to before that message with **Revert and keep changes**. Workspace files stay as they
are: they belong to the running service, and its changes stay in the workspace history for review.
The prompt text returns to the composer for editing and resending; any unsent draft stays above it.
Attachments are not restored, so attach them again before resending.

This removes the selected message and later conversation from the thread and from the provider's
own history. It does not undo external actions. The action is available only when the provider
supports rewind.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this conversation.
Press `ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the
newest prompt clears the composer. Recall walks the prompts loaded in the conversation. Images,
terminal context, and review comments from the original message are not restored, only the text
you typed. A composer that holds an image or a review comment does not count as empty.

When the composer has text, the arrow keys move the caret as usual. Recall takes over only while
the text is an unedited recalled prompt, with the caret on the first visual line for `ArrowUp` or
the last visual line for `ArrowDown`, counting wrapped lines. Editing a recalled prompt turns it
into a normal draft.

## Send while the agent is working

A message sent during a running turn waits at the end of the conversation as a dashed bubble. It
goes out on its own when the agent finishes its next tool call, or when the turn ends. Use the
arrow in the bubble to send it right away, or the X to move it back into the composer. Stop
returns every queued message to the composer.
