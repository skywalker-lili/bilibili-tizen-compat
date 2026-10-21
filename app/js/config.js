/* Runtime settings. tools/deploy.sh rewrites REPORT_TO on every deploy. */

/* bilibili blocklists curl-shaped agents but accepts anything browser-like.
 * AVPlay sends no useful UA of its own, so this is set explicitly on the
 * stream. */
var USER_AGENT = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/7.0 TV Safari/537.36";

/* Dev only: the app posts errors here so a run can be read from the terminal
 * instead of off the screen. Empty disables it. */
var REPORT_TO = "";

/* Set by tools/deploy.sh --selftest: walks the whole flow on the device and
 * reports each step to the collector. Never on in a normal build. */
var SELFTEST = false;

/* Dev only: where diag.js uploads from a dev build (deploy.sh writes it from
 * BILI_DIAG_TO, to test the upload path on the television). Empty means dev
 * builds upload nothing; a release always uses diag.js's own endpoint. */
var DIAG_TO = "";
