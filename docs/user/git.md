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
