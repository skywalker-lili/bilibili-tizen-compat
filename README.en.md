# bilibili for Samsung Tizen TV

**[中文](README.md) · English**

An unofficial, remote-controlled bilibili client customized for **older Samsung Tizen TVs and TVs whose regional app store has no usable bilibili client**. This Q90T compatibility version builds on **[titlog/bilibili-tizen](https://github.com/titlog/bilibili-tizen)**. The original author, **titlog**, created the client architecture and much of its functionality; this branch adapts and extends that work while preserving the original [MIT copyright notice](LICENSE). The TV fetches videos and account data from bilibili directly; no computer needs to stay on while watching. This project is not affiliated with bilibili or Samsung.

| At a glance | Details |
| --- | --- |
| **Upstream base** | **titlog**'s [bilibili-tizen](https://github.com/titlog/bilibili-tizen), `master` at [commit `76003faf3ae1a647a92c532b968e4896427530cb`](https://github.com/titlog/bilibili-tizen/commit/76003faf3ae1a647a92c532b968e4896427530cb), dated **2026-10-02**. This is an exact commit, not an upstream release number. |
| **This derivative** | **1.0.12**; independently maintained under the upstream MIT license and attribution. We plan to offer the changes back to the original maintainer for review. |
| **Tested TV** | **55-inch Samsung Q90T (QN55Q90TAFXZA), Tizen 5.5, firmware 2743**. Installation, QR sign-in, and main remote-control flows were tested here; other models remain unverified. |
| **Highlights** | Tizen 5.5 support, denser four/five-column browsing with publication dates, favorites and followed creators, long-press video actions, comments beside playback, subtitle/autoplay settings, and token-expiry display. See the [itemized changes](#what-this-version-adds-to-the-original-project). |

The installed TV app is named **Bilibili Tizen 兼容版 / Compatibility**. The name does not restrict it to Q90T, but Q90T remains the only model tested so far.

**Status:** tested by the user on a 55-inch 2020 Samsung Q90T with firmware 2743. Other models and regions have not been tested with this version. See the [Chinese README](README.md) for the full usage guide.

## Screenshots from the tested TV

These are photos of the app running on the Q90T. Only embedded file metadata was removed; the image pixels were left unchanged.

![bilibili Tizen compatibility version home screen](docs/screenshots/01-home.jpg)

*Home screen.*

![Video playback screen](docs/screenshots/02-player.jpg)

*Video playback.*

![Comments beside the playing video](docs/screenshots/03-comments.jpg)

*Reading comments while the video continues playing.*

![Video like, coin, and favorite actions](docs/screenshots/04-video-actions.jpg)

*Video like menu, with coin and favorite actions.*

![Installed bilibili app in the TV app bar](docs/screenshots/05-installed-app.jpg)

*The app in the TV app bar after installation.*

## Who is this for?

Use it if your Samsung Tizen TV has no usable bilibili app in its regional store and you are willing to enable Developer Mode and sign/install a Tizen Web app for your own TV. It is **not** an Android APK or a USB-stick installation. If an official app is available and works for you, try that first.

## Compatibility

| Status | TVs |
| --- | --- |
| **Verified** | 55-inch Samsung Q90T (2020), firmware 2743; this package requires Tizen 5.5. |
| **Potentially compatible, untested** | Other 2020 Tizen 5.5 models and newer Samsung Tizen TVs. Installation, decoding, layout, and API behavior still need testing. |
| **Not supported by this package** | Tizen versions below 5.5 (generally 2019 and earlier Samsung TVs), and non-Samsung platforms. |

Samsung lists the 2020 Q90 lineup under Tizen 5.5 in its [TV model groups](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups.html); the [Web engine table](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) covers model years. The package's minimum is declared in [app/config.xml](app/config.xml). If you test another TV, report its full model and firmware version, but never publish its DUID or certificates.

**We have not found a verifiable published minimum Tizen version for an official bilibili client.** Samsung groups 2023 models under Tizen 7.0, but that model-year mapping does not establish the minimum for bilibili's app: each app declares its own minimum in its package, as [Samsung explains](https://developer.samsung.com/smarttv/develop/faq/specifications-and-feature-support.html). Store availability also depends on the [TV model's store region](https://developer.samsung.com/tv-seller-office/faq/tv-seller-office-use.html). **If your TV runs a version below Tizen 7.0 but at least 5.5, and its store has no usable bilibili app, you can try this compatibility version.** This is this project's tentative range, not a claim about an official 7.0 cutoff. Search your TV's store first.

## Features and controls

- Recommendations, continue watching, dynamic feed, watch later, popular videos, rankings, categories, search suggestions, watch history, favorite folders, followed creators, and multiple TV QR-signed-in accounts.
- Up to requested 1080p playback when the video, account, network, and decoder allow it; multipart videos, resume, seek previews, playback speed, related videos, and optional subtitles.
- Video cards show creator, view count, and publication date. Settings offer four or five cards per row and an autoplay-next toggle.
- Short-press **OK** on a card to play. Long-press **OK** (about 0.65 seconds) to open like/coin/favorite actions. Coin spending requires a second confirmation. Arrow keys navigate cards directly.
- During playback, **OK** pauses/resumes, left/right seek, and down opens the information panel with **Read comments** selected by default. Comments and nested replies appear beside the still-playing video. Comments are currently read-only.

## What this version adds to the original project

The original **[titlog/bilibili-tizen](https://github.com/titlog/bilibili-tizen)** by **titlog** already provided the core client: feeds and categories, search, QR sign-in and multiple accounts, playback and multipart videos, resume, seek previews, related videos, and creator uploads. This version starts from [upstream commit `76003fa` (2026-10-02)](https://github.com/titlog/bilibili-tizen/commit/76003faf3ae1a647a92c532b968e4896427530cb) and builds on that foundation with:

1. **Q90T / Tizen 5.5 compatibility:** a lower declared minimum Tizen version and fixes for the older TV browser and playback layout. Only the 2020 Q90T has been tested so far.
2. **Denser browsing and dates:** four or five video cards per row, publication dates on cards and video details, and dates for uploads by followed creators. Long creator names take priority over date formatting.
3. **Expanded My page:** favorite folders and their videos, followed creators and their uploads, plus removing videos from a favorite folder.
4. **Video actions:** long-press OK on a card or use the playback panel to like/unlike a video, spend one or two coins, or add/remove it from a selected favorite folder. Coin spending requires confirmation; arrow-key browsing stays direct.
5. **Comments beside playback:** video continues on the left while comments and nested replies appear on the right. Comments remain read-only.
6. **Playback preferences:** toggles for autoplay-next and subtitles, a four/five-column choice, and a playback panel that initially focuses **Read comments**.
7. **Navigation fixes:** the first related-video card can move down to the next row immediately, and the nonworking Chinese-input button has been removed pending real Pinyin support.
8. **Token-expiry display:** Settings shows the locally stored TV access token's nominal expiry away from the home screen, without exposing the token.

These are changes relative to the upstream client, not a claim that this branch designed every feature from scratch. See [BUGS.md](BUGS.md) and [FEATURES.md](FEATURES.md) for unresolved issues and plans.

Currently unsupported: 4K, danmaku, reliable Chinese Pinyin entry, commenting or liking comments, and casting from a phone to this app. TV-to-bilibili watch-progress reporting has been observed to fail with HTTP 403; local TV resume still works. See [BUGS.md](BUGS.md) and [FEATURES.md](FEATURES.md).

**Known bugs:** watch-progress reporting and comment-like writes receive HTTP 403 on the tested TV. **Planned features:** standalone comment likes, danmaku with density controls, true Chinese Pinyin input, safer account retention across updates, token refresh, and subtitle track selection. See [BUGS.md](BUGS.md) and [FEATURES.md](FEATURES.md) for details.

## Installation

The automated scripts currently target **macOS with zsh**. A manual Windows route is outlined below but has not been verified on a newly configured Windows machine; Linux is also untested. For the Mac scripts you need Node.js, Python 3, Samsung TV-enabled [Tizen Studio tools](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html), a Samsung account, and a Mac on the same LAN as the TV.

1. On the TV, open **Apps → Settings**, enter `12345`, enable Developer Mode, set Host PC IP to the Mac's LAN address, and reboot. See [Samsung's device guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
2. In a checkout containing this Q90T version, run:

   ```bash
   npm ci --prefix tools
   zsh tools/setup.sh
   zsh tools/deploy.sh
   ```

**Windows, manual route (fresh-machine verification pending):** Install Tizen Studio, TV Extensions, and Samsung Certificate Extension using [Samsung's SDK guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html). Set the TV's Developer Mode Host PC IP to your Windows PC's LAN address and reboot the TV. In Tizen Studio, create a TV Web project for Tizen 5.5 or newer and copy this repository's `app/config.xml`, `app/index.html`, `app/icon.png`, `app/css/`, `app/js/`, and `app/vendor/` into it; omit generated `Debug/`, `Release/`, and local configuration files. Create a Samsung certificate profile for **your TV's DUID**, connect the TV through Remote Device Manager on port `26101`, select it, then choose **Run As → Tizen Web Application**. Samsung documents [importing Web projects](https://developer.samsung.com/smarttv/develop/getting-started/creating-tv-applications/importing-tv-applications.html?device=htv) and [connecting/running on a TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html). Retain the same app ID and author certificate for updates; be prepared to sign in again after installation.

**New to sideloading? An AI agent with access to your computer can help.** Put the TV and computer on the **same reachable local network** (usually the same home Wi-Fi; guest networks or client isolation can block the connection). Sign in to your Samsung account on the TV. Under **Apps → Settings**, enter `12345`, enable Developer Mode, set Host PC IP to this computer's LAN address, confirm, and reboot, following [Samsung's device guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html). Then ask an agent that can operate the local computer to read this section and the repository, set up Tizen Studio and a signing certificate **for your TV**, connect, package, sideload, and verify the version actually running. Handle Samsung sign-in, authorization prompts, and remote-control steps yourself. Keep private keys, passwords, TV DUID, and login data on your computer rather than posting them in public chats or committing them. A text-only chatbot without computer access cannot perform the installation. No USB drive is needed, and the computer need not remain on after installation.

`setup.sh` configures the TV and creates a Samsung certificate bound to your TV. Keep the DUID, private keys, certificate password, and TV account data out of GitHub. Daily viewing does not need the Mac; source updates require another deployment. Samsung says [app updates normally retain local Web storage, while uninstalling deletes it](https://developer.samsung.com/smarttv/develop/faq/data-and-file-handling.html). On the tested Q90T, Windows `tz install` removed the old package and its login data; `sdb install` reported only a successful transfer while the old UI remained. Verify the running version before treating a transfer as an update, and be prepared to sign in again.

## How long does sign-in last?

**There is no weekly rescan rule, but sign-in is not guaranteed forever.** TV QR sign-in returns an `expires_in` value; this app stores a nominal access-token expiry of `savedAt + expires_in`. It does not automatically refresh credentials or proactively delete an account at that date. If bilibili stops accepting the session, scan again from **My**.

The default TV sign-in uses community-known parameters that present this client as bilibili's TV client. This is not an endorsement of this project by bilibili. Read the [login-route trade-off](docs/登录路径.md) before using it; the fallback Web QR route has limited multi-account persistence.

A [community-documented historical TV QR response](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/login/login_action/QR.md) uses `15,552,000` seconds, about **180 days**. In **one Q90T test on 2026-10-15**, the user signed in again and reported a nominal expiry date of **2027-04-13** in **Settings → Account**, roughly 180 days later. This is a single observation, with no account or token published, **not a guarantee for other users or a live server-side validity check**. The server may issue a different lifetime or revoke a session earlier.

Starting with **1.0.12**, a read-only **Settings → Account** line shows the stored token's nominal expiry in the TV's local time, without exposing the token. An incorrect TV clock or time zone can affect the displayed date. The fallback Web QR route has no readable token-expiry field.

## Project and license

Before contributing, run `npm ci --prefix tools` and `npm test --prefix tools`. The test command checks JavaScript syntax and references, upstream account/playback invariants, and this fork's account-backed video actions and remote-control navigation. GitHub Actions runs the same checks on pushes and pull requests. Playback and service behavior still need device testing.

The full [Chinese README](README.md) has a detailed walkthrough and troubleshooting. [BUGS.md](BUGS.md) tracks observed defects; [FEATURES.md](FEATURES.md) tracks requested work. This derivative keeps the upstream [MIT license](LICENSE) and attribution; bundled player licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Credentials are stored on the TV and sent to bilibili for authentication, not to a project server. An optional LAN diagnostic collector receives logs only when you start it on your computer; review logs before sharing them.
