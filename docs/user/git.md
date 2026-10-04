# Browse repositories

Open **Git** from the account menu. The repositories belong to your projects and use your Zerops
permissions. A repository opens its source: choose a branch, open a folder, then a file.

Files and folders are read at the commit shown beside their path. A later push does not change the
files you are reading. Choose the branch again or use **Read again** at the branch root to see its
newest commit. **Up one folder** returns to the parent; **Back to repositories** returns to Git.
The page address retains the project, repository, commit and path, so you can reload or share it
with someone who has access.

Text files show at most 256 KiB. Binary files, submodules and incomplete listings say so; clone the
repository to read their full contents. If HQ cannot read a repository, the page names the failure.
Use **Read again** to make another attempt.

## Clone and fetch with your own credentials

Open a repository and expand **Clone with HTTPS**. Copy the clone command and choose **Create Git
password**. When Git asks, use `person` as the username and the new password. Keep it in your Git
credential manager; the password is shown only once and lasts 12 hours. The same credential works
for repositories of that project and uses your current Zerops permissions on every request.

The panel lists your active passwords and when each expires. **Revoke** ends a password immediately
without signing you out of Mate. If a creation attempt loses its answer, use **Read again** to find
and revoke the password that may have been created, then create another. A password cannot be read
back from HQ. Closing the panel clears its displayed password.

If you have Basic user access or above on any attached Zerops project, or are the active account owner, you can push a
topic branch with the same password, for example `git push origin HEAD:refs/heads/my-change`.
Read-only access allows clone and fetch. Lowered permissions or inactive membership stop later
requests, even while the password has not expired.

HQ controls `main`, release tags and `mate/…` change branches. Direct pushes cannot change those
refs, delete branches or replace branch history. Use the project's change and release workflows
for `main` and production.

## Read a shared change

A change link reads once and shows the result. If the change is missing or HQ is unavailable,
choose **Read again** to make another attempt. If HQ refuses access, the page shows the refusal
and offers no **Read again**.
