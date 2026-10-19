#!/bin/sh
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' 0
cd "$tmp"
git init -q
git config user.name Test
git config user.email test@example.invalid
mkdir -p node_modules/dep src/.cache src/venv vendor/acme
printf dependency > node_modules/dep/committed.js
printf cache > src/.cache/committed
printf virtualenv > src/venv/committed
printf vendor > vendor/acme/keep
printf source > app.js
odd=$(printf 'odd\nname\t[1].js')
printf odd > "$odd"
git add .
git commit -qm initial
# A staged removal still present on disk must be captured once, from HEAD.
git rm -q --cached app.js
printf working > app.js
printf untracked > untracked.js
before=refs/t3/checkpoints/posix/runs/portability/before
after=refs/t3/checkpoints/posix/runs/portability/after
capture() {
  git -c "alias.mate-snapshot=!$SNAPSHOT_SCRIPT" mate-snapshot capture "$1" 10 128 1024 4096 "${2-}" ''
}
if ! capture "$before" > .git/before-result; then
  printf 'ASSERTION: POSIX workspace capture must succeed\n' >&2
  exit 1
fi
oid=$(git rev-parse "$before")
[ "$(git show "$oid:app.js")" = working ]
[ "$(git show "$oid:$odd")" = odd ]
[ "$(git show "$oid:untracked.js")" = untracked ]
[ "$(git show "$oid:vendor/acme/keep")" = vendor ]
git ls-tree -r --name-only "$oid" > .git/paths
if grep -E 'node_modules|\.cache|venv' .git/paths; then
  printf 'ASSERTION: dependencies must be excluded before the name cap\n' >&2
  exit 1
fi
[ "$(git ls-tree -r --format='%(objectname)' "$oid" | wc -l)" -eq 4 ]
rm untracked.js
printf after > app.js
capture "$after" "$oid" > "$tmp/.git/after-result"
after_oid=$(git rev-parse "$after")
[ "$(git show "$after_oid:app.js")" = after ]
if git cat-file -e "$after_oid:untracked.js" 2>/dev/null; then
  printf 'ASSERTION: deleted files must be absent from the after snapshot\n' >&2
  exit 1
fi
# Content Git already holds spends none of the total budget.
held=refs/t3/checkpoints/posix/runs/held/before
if ! git -c "alias.mate-snapshot=!$SNAPSHOT_SCRIPT" mate-snapshot capture "$held" 10 128 1024 1 '' '' > .git/held-result; then
  printf 'ASSERTION: content already in Git must not spend the total budget\n' >&2
  exit 1
fi
[ "$(git rev-parse "$held^{tree}")" = "$(git rev-parse "$after_oid^{tree}")" ]
# A selection containing only excluded files succeeds with an empty snapshot.
mkdir empty
cd empty
git init -q
mkdir node_modules
printf dependency > node_modules/only.js
capture "$before" > .git/result
[ -z "$(git ls-tree -r "$before")" ]
# Failure to fit names into the cap still refuses instead of capturing a prefix.
printf source > app.js
if git -c "alias.mate-snapshot=!$SNAPSHOT_SCRIPT" mate-snapshot capture "$after" 10 3 1024 4096 '' '' > .git/result 2> .git/error; then
  printf 'ASSERTION: the candidate name cap must refuse a partial snapshot\n' >&2
  exit 1
fi
grep -q 'candidate path byte limit exceeded' .git/error
printf 'POSIX snapshot assertions passed\n'
