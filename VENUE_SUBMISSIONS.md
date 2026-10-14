# Venue submissions

The **Add Venue** button opens a form beside **Delete Expired Venues**.
The form creates a public pull request. A venue appears on the website only after the repository owner merges its PR.

The popup offers **From a URL** and **Enter manually**. Both lead to the same venue form and PR review process.
The feature uses Cloudflare Workers, Workers AI, a SQLite Durable Object, Turnstile, and GitHub Actions.
These Cloudflare products support the Free plan. Usage remains subject to their account limits.
See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## URL drafts

1. Paste the venue's public HTTPS website or call-for-papers URL and complete bot verification.
2. The Worker verifies Turnstile action `parse_venue` and reserves a URL lookup.
3. A script checks the destination's public DNS addresses, follows at most three validated redirects, and reads one HTML or text page.
4. It removes scripts and hidden content, then sends bounded text to Cloudflare Workers AI using `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and a JSON schema.
5. The Worker and browser validate the extracted values. Unknown facts remain blank; no CORE ranking is inferred.
6. Review and edit the draft, fill missing fields, and confirm that its details match the website.
7. A fresh Turnstile verification with action `add_venue` protects the existing submission flow below.

Parsing does **not** start a workflow, open a PR, or consume a venue submission slot.
It has a separate durable limit of **ten lookups per UTC day across all visitors**, and **three per network address per day**.
Failed lookups retain their reservations to bound fetching and inference costs.
The manual form remains available when parsing fails, its daily allowance is exhausted, or Workers AI is unavailable.
No paid plan or AI Gateway is configured. The account's shared free Workers AI allowance still applies.

Fetched pages are limited to 256,000 bytes, with a 12-second fetch timeout.
Model input is limited to 16,000 bytes of page text and one inference with at most 1,200 output tokens and a 40-second wait.
The model receives no credentials, has no tools, and cannot follow additional links or write repository contents.
The server enforces field lengths, deadline validity, tags, and URL rules independently of model schema enforcement.

The form uses minute precision. If a source specifies seconds, the draft drops the seconds and displays a notice to check the exact time.
PDFs, login-protected pages, JavaScript-only content, and unreadable or oversized pages require manual entry.
AI extraction can misread facts; confirm the year, submission rounds, deadline timezone, location and publication type before submitting.

The supplied public page URL and its extracted text are processed by Cloudflare Workers AI.
The quota stores a signing-key-protected daily hash of the visitor's network address, without storing the raw address.
Parsing logs do not include page URLs, page text, model output or visitor addresses.
Quota records are removed after eight days.

## Request flow

1. The browser checks the form and completes Turnstile verification.
2. The Worker checks the data, Turnstile action, and exact production hostname.
3. One Durable Object reserves a slot for the repository and UTC date.
4. The Worker signs the submission and starts the trusted GitHub workflow.
5. The workflow checks the signature, expiry, schema, and existing venues.
6. The workflow reserves an immutable quota tag, appends one record, and opens a PR.
7. A signed callback gives the popup its PR link.

The daily limit is **five submissions across all visitors**, including failed or uncertain accepted requests.
Reservations prevent concurrent requests from exceeding the limit.
A failed dispatch retains its slot because GitHub can accept a request before the connection fails.
Invalid data and failed bot verification do not reserve a slot.
Do not delete daily quota tags to retry a failed request.

## Security and review

- The Worker accepts the configured website origin. Origin checking supplements bot verification and the daily quota.
- Turnstile verification requires `success: true`, the expected action (`parse_venue` for drafts or `add_venue` for submissions), and hostname `alihamzamalik.me`.
- Requests have size limits and a per-IP rate limit. The IP limit applies per Cloudflare location.
- Names, dates, tags, timezones, and URLs have strict checks in both JavaScript and Python.
- Both validators reject HTML, Liquid templates, control characters, credential URLs, IP URLs, and reserved local domains.
- Only the dedicated draft endpoint fetches visitor-supplied URLs. Submission and PR creation do not fetch them.
- URL fetching checks public IPv4/IPv6 DNS answers for every redirect, rejects local and special-purpose destinations, and forwards no visitor credentials or cookies.
- DNS checks precede a normal Worker fetch, which resolves the host independently; these checks do not pin DNS answers. Do not attach private-network or authenticated service bindings to the parser.
- HMAC signatures protect workflow inputs and callbacks. Dispatch tokens alone cannot sign submissions.
- The GitHub dispatch token needs only **Actions: Read and write** on `alirafiqmalik/sec-deadlines`.
- The workflow uses its temporary `GITHUB_TOKEN` to create the branch and PR. The Worker cannot write repository contents.
- Automated PRs change only `_data/conferences.yml` and append exactly one venue.
- The **Venue data safety** check compares the record with its immutable quota proof.
- The `pull_request_target` check runs trusted base-branch code. It never checks out or executes submitted code.
- Commit statuses cover generated PRs immediately. Some generated PR workflows require GitHub approval before they can run.
- Application logs contain submission references and quota slots. They omit credentials, receipts, IPs, and venue details.
- Request invocation logs and traces are disabled to reduce unnecessary data collection.
- Receipts stay in session storage for status checks. The server stores their hashes and removes daily records after eight days.

Bot verification does not establish identity or prove that a conference is legitimate.
Before merging, inspect the official call for papers, deadline, timezone, and venue scope.
Review unusual URLs and any failed **Venue data safety** status.
Code-only PRs need a separate code review, even when the venue check passes.

## Activation

Production uses `https://sec-deadlines-submissions.alirafiqmalik.workers.dev`.
The public endpoint and widget key are in configuration. Secret values stay in Cloudflare and GitHub secret managers.
The steps below describe how to activate a fresh deployment or restore this setup.

1. Authenticate Cloudflare for the intended account.
2. Create a managed Turnstile widget for `alihamzamalik.me`, without pre-clearance.
3. Set `TURNSTILE_SITE_KEY` in `backend/wrangler.jsonc`. The site key is public.
4. Deploy `backend/` with Wrangler while `SUBMISSIONS_ENABLED` remains `false`.
5. Create a fine-grained GitHub token restricted to this repository and **Actions: Read and write**.
6. Give the token an expiry. Store it only as Worker secret `GITHUB_DISPATCH_TOKEN`.
7. Generate a random signing value with at least 32 bytes of entropy.
8. Store the same signing value as Worker secret and repository Actions secret `SUBMISSION_SIGNING_KEY`.
9. Store the Turnstile secret as Worker secret `TURNSTILE_SECRET`.
10. Set repository Actions variable `SUBMISSION_API_URL` to the Worker origin, without a trailing slash.
11. Set `venue_submission_api` in `_config.yml` to that same origin.
12. Set `SUBMISSIONS_ENABLED` to `true`, then deploy the Worker.
13. Test a real production Turnstile token, its replay rejection, and the PR callback before declaring activation complete.

The URL option additionally requires the `AI` binding and `EXTRACTION_ENABLED: "true"` from `backend/wrangler.jsonc`.
No additional API key is needed for the AI binding.
Smoke-test the deployed parser with a known public call-for-papers page and confirm that its draft still requires review before submission.

The expected origin is `https://sec-deadlines-submissions.<account-subdomain>.workers.dev`.
Keep it consistent in both configurations.
GitHub repository settings must allow Actions to create pull requests.
Keep the default branch named `master`, or update both the workflow guard and processor before changing it.

Never place secret values in Git, browser code, issue bodies, or chat.
Use the authenticated secret manager or standard input for secret writes.
Ignored `.dev.vars` files are available for local development. Do not use them for production credentials.

## Deployment verification

The production endpoint is enabled as of 10 October 2026.
The [43 automated checks](https://github.com/alirafiqmalik/sec-deadlines/actions/runs/38024342943) and [website deployment](https://github.com/alirafiqmalik/sec-deadlines/actions/runs/38024342297) passed.

Live API checks rejected foreign origins, unsigned callbacks, unknown receipts, forged bot tokens, private-address URLs, and oversized requests.
The restricted GitHub token dispatched an intentionally invalid signed request.
That [security test](https://github.com/alirafiqmalik/sec-deadlines/actions/runs/38024824242) failed as expected with a signature mismatch, before any venue write.
It did not create a PR or consume a daily slot.

A complete production form submission and PR callback still require verification in a normal browser.
The automated browser could not complete the production Turnstile challenge.
Production bot checks remain enabled. No test venue has been submitted or merged.

On 14 October 2026, the URL parser was checked using a temporary authenticated Worker with the same extraction code and a real Cloudflare AI binding.
It read the [IEEE S&P 2027 call for papers](https://www.ieee-security.org/TC/SP2027/cfpapers.html) and returned its venue year, event dates, location, two paper submission deadlines, and AoE timezone.
The returned draft passed the shared field validator. This check created no PR and consumed no production venue or URL quota slot.
The temporary Worker was deleted after the check.
The production `/api/config` reports URL parsing enabled, with ten shared daily lookups, three per network address, and the original five-submission limit.
Live `/api/extract` checks rejected invalid bot tokens, private-address URLs, oversized bodies, and foreign origins before parsing.
All **62 automated checks** passed locally: 13 Python security checks, 39 Worker checks, and 10 browser checks.
The production bot-verified URL request and final PR callback remain normal-browser checks; the isolated parser smoke test does not replace them.

## Tests

Run the Python checks from the repository root:

```sh
python3 -m pip install -r scripts/requirements-venue.txt
python3 -m unittest discover -s tests -v
```

Run the Worker checks from `backend/` with Node.js 24 or later:

```sh
npm ci
npm test
npm run check
```

Install Ruby and Jekyll 4.4.1 before running browser tests:

```sh
gem install jekyll -v 4.4.1 --no-document
npx --no-install playwright install chromium
npm run test:ui
```

Set `CHROMIUM_PATH` to use an existing Chromium executable.
Browser tests use explicit Turnstile and backend stubs. They do not prove that production credentials work.
Worker tests use the real Durable Object runtime, including concurrent reservations and storage persistence.
Tests disable remote bindings and stub inference, so CI needs no Cloudflare credentials and consumes no AI allowance.
The **Venue submission tests** workflow runs these checks for relevant code changes.

## Maintenance

- Renew the GitHub dispatch token before its expiry. Replace only the Worker secret.
- To stop submissions, set `SUBMISSIONS_ENABLED` to `false` and deploy the Worker.
- To stop only URL parsing, set `EXTRACTION_ENABLED` to `false` and deploy the Worker. The popup then defaults to manual entry.
- If a visitor reports a submission reference, find it in **Create venue PR** workflow inputs or Worker logs.
- If GitHub accepted a dispatch, rerun that workflow within its 24-hour signature window.
- The same signed request reuses its quota proof and existing PR. It does not create another PR.
- If dispatch never reached GitHub, the reserved daily slot stays consumed. Do not clear the quota to recover it.
- Quota tags retain public submission evidence. They are not release tags.
