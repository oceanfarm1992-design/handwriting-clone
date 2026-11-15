# Security

Handwriting Clone runs entirely in the browser. There is no server and no account, and handwriting samples never leave the device unless the user exports them.

## Reporting a problem

Please report security problems privately through the repository's **Security** tab → **Report a vulnerability**. If that is not available, open an issue that says only that you have found a security problem, without details, and the maintainer will contact you.

## How the project protects itself

Three scheduled bots run as GitHub Actions. Each opens an issue when it finds a problem and closes it automatically once the problem is fixed.

| Bot | When | What it checks |
| --- | --- | --- |
| Security check | Weekly (Wednesday) and on every pull request | CodeQL code scanning; known vulnerabilities in the CDN libraries (OSV.dev); every external URL goes to an approved host and is pinned to an exact version; every library carries an integrity hash that matches the served file; no secrets in tracked files; no personal handwriting photos, scans or profiles committed; no eval-style code |
| Health check | Weekly (Monday) and on pull requests that touch the app | Unit tests; every library and sample font still reachable; the live site and every file it loads; a headless-browser smoke test of the real app |
| Update bot | Monthly (1st) | Moves CDN libraries to their newest same-major release that is at least 14 days old, re-runs all checks, then opens a pull request. New major versions are reported for a person to test. Dependabot updates the workflow actions weekly. |

Every library the app loads is pinned to an exact version with a SHA-384 integrity hash (see `js/cdn-libs.js`). The browser, or for ES modules the app itself, refuses to run a file that does not match.

If a known vulnerability cannot be fixed straight away, it can be accepted temporarily in `security/accepted-advisories.json` with a reason and a review date. The security check fails again once that date passes.
