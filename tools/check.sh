#!/bin/zsh
# The gate every package goes through, whether it is headed for the living-room
# TV (deploy.sh) or for strangers (release.sh). One copy, so the two can never
# drift: a check added to only one of them is a check the other ships without.
# Exits non-zero on the first failure; callers refuse to package.
set -e

ROOT="${0:A:h:h}"
APP="$ROOT/app"

# node --check only proves each file parses. It happily ships code that calls a
# function deleted from another file, which is exactly how a build went out where
# pressing OK on the home screen did nothing.
echo "== checking =="
for f in "$APP"/js/*.js; do node --check "$f" >/dev/null || { echo "  syntax error in $f"; exit 1; }; done
node "$ROOT/tools/lint.mjs" || exit 1
# The account layer fails silently on the device — history filed under the wrong
# person, a cookie riding along from the previous account — so it is verified
# against a fake localStorage here, where a wrong answer is an assertion.
node "$ROOT/tools/md5-verify.mjs" >/dev/null || { echo "  md5 is wrong; TV login would be rejected"; exit 1; }
node "$ROOT/tools/accounts-verify.mjs" || exit 1
# An invalid manifest does not throw — the player refuses it and the viewer just
# sees a spinner. One unescaped ampersand in a stream url is enough to cause it.
node "$ROOT/tools/mpd-verify.mjs" >/dev/null || { echo "  the DASH manifest is malformed"; exit 1; }
# Mirrors are ordered, never dropped. Dropping one played fine for a day and
# then walled every 1080p video the evening the primary CDN went sour.
node "$ROOT/tools/mirrors-verify.mjs" >/dev/null || { echo "  mirror ordering is wrong"; exit 1; }
# The interactive features (PR #2): a write must never leave without a
# credential, and a hold on OK opens the menu without starting the video.
node "$ROOT/tools/compat-api-verify.mjs" || { echo "  video actions or library API regressed"; exit 1; }
node "$ROOT/tools/nav-verify.mjs" || { echo "  remote navigation regressed"; exit 1; }
# Tizen 5.5 has no flex gap. A new gap without its fallback looks fine on any
# set made since, and cramped on the ones this check exists for.
node "$ROOT/tools/legacy-css-verify.mjs" || exit 1
# 弹幕: parsing, dedupe and lane allocation. A lane bug does not throw — it draws
# comments on top of each other, or none at all.
node "$ROOT/tools/danmaku-verify.mjs" >/dev/null || { echo "  danmaku parsing or lanes regressed"; exit 1; }
