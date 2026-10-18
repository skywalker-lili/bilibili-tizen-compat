# bilibili on Samsung TV

**[中文](README.md) · English**

A bilibili client for Samsung Tizen televisions, driven entirely by the remote.
The TV talks to bilibili directly: **no backend, no proxy, no server, and your
credentials never leave the set.**

Several people can be signed in at once, each with their own watch history;
what you half-watched on the phone is under the cursor when the TV comes on.

> LG webOS has a good one, [bili-webos](https://github.com/asdf17128/bili-webos).
> The Samsung side was empty. This fills that gap.
>
> **Not affiliated with bilibili or Samsung.** Personal project, MIT.
>
> Sibling projects: [douyin-tizen](https://github.com/titlog/douyin-tizen) (Douyin on Samsung TVs) and
> [telegram-tizen](https://github.com/titlog/telegram-tizen) (the videos in your Telegram groups and channels).

|  |  |
|---|---|
| ![Home](docs/screenshots/01-home.jpg) | ![Playback](docs/screenshots/03-player-scrub.jpg) |
| Three big cards a row, readable from the sofa; signed in, the top row is 「continue watching」 and the cursor starts on it | Scrubbing with thumbnail previews; up to 1080p H.265 when signed in |
| ![Panel](docs/screenshots/04-panel.jpg) | ![Comments](docs/screenshots/05-comments.jpg) |
| Press down while playing for the description, speed, parts and related videos — **the video keeps running**; like / coin / favourite and comments are here too | Comments and replies beside the video, which keeps playing |
| ![Settings](docs/screenshots/06-settings.jpg) | ![Search](docs/screenshots/02-search.jpg) |
| Settings: autoplay, subtitles, and cards per row to suit the TV and the sofa | Search, with the TV's own Chinese IME one button away |

## Will it run on my TV

| | |
|---|---|
| **Verified** | Samsung 2023 65" **CU7090**, firmware Tizen 9.0 (Chromium 120). Every measurement in this project comes from this one set |
| **Community-tested** | Samsung 2020 55" **Q90T**, Tizen 5.5 (Chromium 69), tested by the author of [PR #2](https://github.com/titlog/bilibili-tizen/pull/2) on their branch; the old-engine compatibility comes from there |
| **Very likely** | 2020 onwards (Tizen 5.5+). Playback uses standard MSE and AVPlay, nothing model-specific — but **no other model has been tried yet** |
| **No** | Non-Samsung sets; Samsung models from before 2016 (engine too old) |

A build from source reports its engine string and codec support on boot; that
line is the first thing to read (the release package reports nothing). **Either
way, if it works or fails on another model, please open an issue with the model
and firmware version** — that is how this table grows.

## Install

Samsung's store does not accept third-party clients for other people's services
(it pulled the unofficial Twitch app in 2019 for exactly that), so this is
sideloaded — **once**; after that the app opens from the TV like any other. Two
ways:

| | Release package (recommended) | From source |
|---|---|---|
| For | Watching bilibili on the TV | Changing the code, reading diagnostics |
| Needs | A computer (Windows / macOS / Linux) **or an Android phone** with [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) | macOS, Node, Python 3, Tizen Studio CLI |
| Upgrade | Download the new `.wgt`, install it again | `git pull`, run `deploy.sh` again |

**From the next release on, the app updates itself**: a minute after it opens,
when nothing is playing, it checks this repository, downloads a newer version,
verifies its signature and runs it from the next launch; a version that fails to
start falls back to the one installed. It can be switched off in 设置. Until then
(and to go back to an older version) upgrading is manual.

**Both ways start here:** enable Developer Mode on the TV — on the Apps screen,
type `12345` with the remote, switch it on, and set Host PC IP to the computer or
phone you will install from — then **power-cycle the set completely**. Without
that the registration does not take, and the symptom is the TV not being found,
or connections timing out silently.

**Everybody gets stuck on the certificate; both ways handle it.** Samsung sets
from 2023 on only accept Samsung-issued distributor certificates — the ones that
ship with Tizen Studio all fail with `Invalid certificate chain`. The certificate
is bound to your TV's DUID and is requested by signing in to your own Samsung
account once.

### Release package

1. Download `bilibili-tizen-<version>.wgt` from
   [Releases](https://github.com/titlog/bilibili-tizen/releases/latest).
2. Install [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung/releases),
   desktop or Android.
3. Open it, select your TV (enter its IP if it is not listed), choose a custom
   `.wgt` as the app, pick the file from step 1, and install. The first time, it
   asks you to sign in to Samsung and issues the certificate for this TV.

The package is re-signed with your own certificate on install, so the same file
works for everyone.

### From source

You need Node, Python 3, and the
[Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)
command-line tools (**not the IDE**). `setup.sh` opens the Samsung account login,
requests the certificate for you, and needs no Eclipse, no sudo, no
certificate-manager GUI.

```bash
git clone https://github.com/titlog/bilibili-tizen.git && cd bilibili-tizen
zsh tools/setup.sh      # once: finds the TV, reads its DUID, issues the certificate; config lives outside the repo
zsh tools/deploy.sh     # check, sign, install, launch — about 15 seconds
```

> **Do not switch between the two.** They sign with different certificates, and
> the TV will not let a package signed with one replace the same app signed with
> the other. To switch, delete the app on the TV first, then install — that wipes
> the QR sign-ins and local watch history, so accounts need scanning again;
> progress already reported to the bilibili account is kept.

> Only need the certificate, for something unrelated? It is a standalone tool:
> **[samsung-tv-cert](https://github.com/titlog/samsung-tv-cert)**
> [![npm](https://img.shields.io/npm/v/samsung-tv-cert.svg)](https://www.npmjs.com/package/samsung-tv-cert)
> — `npx samsung-tv-cert --duid <your DUID>`. Useful for Jellyfin, community
> Twitch, or anything else you sideload onto a Samsung set.

## Accounts and privacy

- QR sign-in, any number of accounts, switching needs no rescan.
- **Credentials are stored only in the TV's local storage.** No server, no
  analytics, no third party; the app talks to `bilibili.com` and its CDN and
  nothing else. Stream URLs are pre-signed, so media requests carry no account.
- Watch progress is reported back to bilibili (every 30 s), so the phone and the
  web can pick up where the TV left off — and vice versa.
- Like, coin and favourite write to your bilibili account, and only when you pick
  them on the TV; a coin cannot be taken back, so it asks once more.
- The default sign-in is the **TV login** route, signed with the official TV
  client's appkey. That is what makes multiple accounts and progress reporting
  possible; it also means your client presents itself to bilibili as the official
  TV client. That is a terms-of-service judgement, not a technical one; the web
  QR route is there if you would rather not, at the cost of one account and no
  progress reporting. The full trade-off is in [`docs/登录路径.md`](docs/登录路径.md) (Chinese).
- An expired token means scanning again (the refresh endpoint has not been
  verified against the server, and guessing on the one path that holds the whole
  household's credentials is not something this project does).
- From source, `deploy.sh` bakes **your computer's LAN address** into the package
  as the destination for diagnostic logs; anything is received only while you run
  the collector on that computer, and only on your LAN. **The release package has
  no such address** and sends logs nowhere.

## What it does, and what it deliberately does not

**Does**: recommendations / popular / rankings / food / dance / dynamic feed /
watch-later / search with the TV's own Chinese IME, multi-part uploads, resume
(remembers which part, picks up from the phone), autoplay next, scrub previews,
parts and related videos over a running video, uploader pages (press the
uploader's name in the panel, or 右 on the end-of-video screen, for everything
they have posted; 返回 goes back to the tab you came from). About **2.5–3.5 s**
from OK to a picture, 1080p H.265.

Also: danmaku (off / sparse / standard / dense, in 设置 or the playback panel);
collections (合集 — a row of episodes in the panel, and the next episode plays
when one ends); a quality cap (highest by default: 4K for 大会员 accounts) and
clearing this set's watch history; favourite folders and followed uploaders under 「我的」; comments (with
replies) beside the running video; subtitles; like, coin and favourite (hold OK
on a card, or the buttons in the playback panel; a coin asks once more); and a
「设置」 tab — autoplay next, subtitles on/off, and cards per row (3 / 4 / 5, to
suit how big the TV is and how far the sofa). These come from
[PR #2](https://github.com/titlog/bilibili-tizen/pull/2).

**Does not**:
- **Casting from the phone.** A cast receiver has to listen on a port; a Tizen
  web widget cannot, regardless of how official it is. The substitute is
  watch-later: tap on the phone, open on the TV.
- **Liking or posting comments.** The TV's direct calls to the comment write endpoints are refused (403); comments are read-only.

## FAQ

**The TV is not found, or `sdb` cannot reach it.** Is the IP registered in
Developer Mode the *current* IP of the computer (or phone) you install from, and
did you power-cycle the set after changing it? A DHCP change means re-registering.

**`Invalid certificate chain` (from source).** You are using a Tizen-bundled
certificate. Run `zsh tools/setup.sh` for a Samsung-issued one.

**The install says the TV already has this app signed with a different
certificate.** It was installed the other way; see "Do not switch between the
two" above.

**A video will not open: 「视频流被拒绝（403）」.** Usually CDN throttling or a
per-file refusal. The app rotates mirrors, escalates the token, switches codec
family and drops tiers on its own; the message means all of that was tried. Wait
a few minutes or pick another video.

**The dynamic feed / watch-later tab is empty.** Both need a signed-in account;
scan from 「我的」 first.

**A code change has no effect.** Check the boot line the TV reports; `deploy.sh`
derives the package name from `config.xml`, so after renaming the app make sure
it is pushing the new package.

## For developers: what this platform actually allows

The client is the result; the time went into finding out what the platform can
do. Each of these cost at least a day and none of them is written down elsewhere:

- **bilibili needs no `Referer`, but rejects by UA.** Probing with bare `curl`
  makes every response read like "Referer required" — a false signal that nearly
  put a proxy into this project that it never needed.
- **This firmware's widget cannot send a `Cookie` header.** Chromium 120 silently
  drops forbidden headers, so signed-in sessions ride in the query as
  `access_key`. The earlier "it can" conclusion was measured with one account on
  the set, where the measurement had no power to distinguish anything.
- **The same upload plays on the phone and not on the TV because of playurl's
  `platform`.** Tokens minted by the web endpoint get 403'd by strict CDN nodes;
  tokens from the app endpoint are accepted.
- **AVPlay plays DASH, but the manifest must arrive over HTTP**, and a widget
  cannot listen on a port — so DASH goes through MSE. The same wall is why
  casting cannot be built.
- **Switching CDN nodes does not work, throttling is per IP, mirrors must be
  ranked and never dropped.** Which mirror is dead is that day's weather: the same
  host 403'd all evening and served all of the next.

The stories behind each are in [`docs/平台坑.md`](docs/平台坑.md) (Chinese); every
measurement, log line and the debugging discipline are in [`CLAUDE.md`](CLAUDE.md),
the project's working notes, including the conclusions that were later overturned.

## Layout

```
app/          the client (ES5, IIFE, no build step)
  vendor/     Shaka Player, precompiled, checked in
spike/        the rigs that established the platform facts
tools/
  setup.sh            once: your TV, your certificate
  deploy.sh           check, sign, install, launch
  release.sh          build the release package: from HEAD, no diagnostics address, no personal certificate
  check.sh            the checks deploy and release share; any failure refuses to package
  samsung-cert.mjs    Samsung certificate issuance without a GUI
  devserver.mjs       run the client in a desktop browser (screenshots, UI work without deploying)
  collect.mjs         diagnostics collector on :8099
  lint.mjs            catches calls to things that do not exist
  *-verify.mjs        manifest / accounts / md5 / QR / interaction APIs / hold-to-open
                      navigation / old-engine layout — any failure refuses to ship
docs/         platform notes, login routes, the full stream-token investigation
CLAUDE.md     everything learned, every trap, and how to debug on a retail set
```

## Debugging

A retail set has every convenience switched off: `dlog` returns nothing, the Web
Inspector port never opens, `sdb shell` is `closed`. So the app reports on
itself — `tools/collect.mjs` listens on 8099 and `deploy.sh` writes the address
into the build.

```bash
node tools/collect.mjs | tee /tmp/bili.log   # terminal 1, first
zsh tools/deploy.sh                          # terminal 2
```

With no collector the reports fail silently; after five failures in a row the
app sleeps five minutes and tries again, so a collector started late receives
lines within five minutes, and a redeploy restores it at once.

```bash
zsh tools/deploy.sh --selftest
```

walks the whole flow on the set unattended — grid, playback, panel, scrolling,
scrubbing, long seeks across the buffer, pause, resume, exit, accounts, settings,
favourites and followings, comments, subtitles — reporting each step. **It is the only way to check a build without someone on the sofa.**
Install a normal build again when it is done.

## Licence

MIT. bilibili is a trademark of its owner; this project is not affiliated. The
precompiled Shaka Player in `app/vendor/` carries third-party code under
Apache-2.0, MIT and BSD-3-Clause; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
