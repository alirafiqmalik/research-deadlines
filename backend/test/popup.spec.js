import { expect, test } from "@playwright/test";

const endpoint = "https://sec-deadlines-submissions.test-account.workers.dev";
let received;

async function open(page, enabled = true, method = "manual", extractionEnabled = true) {
  await page.route(endpoint + "/api/config", route => route.fulfill({ json: { enabled, extractionEnabled, siteKey: "browser-test-key" } }));
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", route => route.fulfill({ contentType: "application/javascript", body: `window.turnstile = {
    render(selector, options) { this.options = options; document.querySelector(selector).textContent = 'Bot verification (test stub)'; queueMicrotask(() => options.callback('test-only-token')); return 'test-widget'; },
    reset() { queueMicrotask(() => this.options.callback('test-only-token')); },
    remove() { document.querySelector('#venue-verification').textContent = ''; }
  };` }));
  await page.goto("./");
  await page.evaluate(api => document.getElementById("add-venue-dialog").dataset.api = api, endpoint);
  await page.getByRole("button", { name: "Add Venue", exact: true }).click();
  if (enabled) {
    if (method === "manual") await page.locator('#venue-methods [value="manual"]').check();
    await expect(page.locator(method === "url" && extractionEnabled ? "#venue-extract" : "#venue-submit")).toBeEnabled();
  }
}

async function fill(page) {
  const form = page.locator("#add-venue-form");
  for (const [name, value] of Object.entries({ name: "Example S&P", link: "https://conference.org/", source: "https://conference.org/cfp", date: "June 12–14", place: "London, UK", description: "Security and privacy" })) await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('[name="venue-topic"][value="SEC"]').check();
  await form.locator('[name="venue-kind"][value="CONF"]').check();
}

test("keyboard modal, mobile sizing, and existing deadlines remain usable", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await open(page);
  await expect(page.locator(":focus")).toHaveAttribute("name", "name");
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.locator("#add-venue-dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#add-venue-dialog")).not.toBeVisible();
  await expect(page.locator("#add-venue-btn")).toBeFocused();
  await page.waitForFunction(() => [...document.querySelectorAll('.timer')].every(el => el.textContent.trim()));
  const all = await page.locator(".conf").count();
  await page.locator("#show-past-checkbox").check();
  await expect(page.locator(".conf:visible")).toHaveCount(all);
  await page.locator("#SEC-checkbox").check();
  expect(await page.locator(".conf:visible:not(.SEC)").count()).toBe(0);
  await page.locator("#SEC-checkbox").uncheck();
  await page.locator("#hide-past-btn").click();
  expect(await page.locator(".conf.past:visible").count()).toBe(0);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#delete-expired-btn").click();
  expect(await page.locator(".conf").count()).toBeLessThan(all);
  for (const href of await page.locator('a[href*="/ical/"]').evaluateAll(links => links.map(el => el.getAttribute("href")))) {
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  }
  expect(errors).toEqual([]);
});

test("submits entirely in popup, prevents double clicks, and shows the PR", async ({ page }) => {
  let requests = 0, polls = 0;
  await page.route(endpoint + "/api/submissions", async route => {
    received = route.request().postDataJSON(); requests++;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ status: 202, json: { id: received.id, day: new Date().toISOString().slice(0, 10), status: "queued" } });
  });
  await page.route(endpoint + "/api/status?**", route => { polls++; return route.fulfill({ json: polls === 1 ? { status: "queued" } : { status: "created", prUrl: "https://github.com/alirafiqmalik/research-deadlines/pull/123" } }); });
  await open(page); await fill(page);
  await page.locator("#venue-submit").dblclick();
  await expect(page.locator("#venue-status")).toContainText("Submission received");
  await page.locator("#venue-check").click();
  await expect(page.locator("#venue-pr-link")).toHaveAttribute("href", "https://github.com/alirafiqmalik/research-deadlines/pull/123");
  expect(requests).toBe(1);
  expect(received.payload.venue.tags).toEqual(["CONF", "SEC"]);
  expect(received.payload.venue.deadline).toEqual(["TBA"]);
  expect(received.receipt).toMatch(/^[0-9a-f]{64}$/);
  await page.keyboard.press("Escape");
  await page.locator("#add-venue-btn").click();
  await expect(page.locator("#venue-pr-link")).toBeVisible();
  await page.locator("#venue-another").click();
  await page.locator('#venue-methods [value="manual"]').check();
  await expect(page.locator('#venue-fields [name="name"]')).toHaveValue("");
  await expect(page.locator("#venue-submit")).toBeEnabled();
});

const draft = () => ({ name: "ExampleConf", year: new Date().getUTCFullYear() + 1, link: "https://conference.org/cfp", source: "https://conference.org/cfp", description: "Security conference", date: "June 12–14", place: "London, UK", deadline: [`${new Date().getUTCFullYear()}-12-01 23:59`], timezone: "Etc/GMT+12", tags: ["SEC", "CONF"] });

test("offers URL and manual options and requires review before submitting a parsed draft", async ({ page }) => {
  let lookups = 0, submissions = 0;
  await page.route(endpoint + "/api/extract", async route => {
    const body = route.request().postDataJSON();
    expect(body.url).toBe("https://conference.org/cfp");
    expect(body.turnstileToken).toBe("test-only-token"); lookups++;
    await new Promise(resolve => setTimeout(resolve, 80));
    await route.fulfill({ json: { draft: draft(), missingFields: [] } });
  });
  await page.route(endpoint + "/api/submissions", route => {
    submissions++; received = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { day: new Date().toISOString().slice(0, 10), status: "queued" } });
  });
  await page.route(endpoint + "/api/status?**", route => route.fulfill({ json: { status: "created", prUrl: "https://github.com/alirafiqmalik/research-deadlines/pull/123" } }));
  await open(page, true, "url");
  await expect(page.locator("#venue-url")).toBeFocused();
  await expect(page.locator("#venue-details")).not.toBeVisible();
  expect(await page.evaluate(() => window.turnstile.options.action)).toBe("parse_venue");
  await page.locator("#venue-url").fill("https://conference.org/cfp");
  await page.locator("#venue-extract").dblclick();
  await expect(page.locator("#venue-draft-notice")).toContainText("Draft ready");
  await expect(page.locator('[name="name"]')).toHaveValue("ExampleConf");
  await expect(page.locator('[name="deadline"]')).toHaveValue(draft().deadline[0]);
  await expect(page.locator("#venue-submit")).toBeDisabled();
  expect(lookups).toBe(1); expect(submissions).toBe(0);
  expect(await page.evaluate(() => window.turnstile.options.action)).toBe("add_venue");
  await page.locator('[name="place"]').fill("Edited location");
  await page.locator("#venue-reviewed").check();
  await page.locator("#venue-submit").click();
  await expect(page.locator("#venue-pr-link")).toBeVisible();
  expect(received.payload.venue.place).toBe("Edited location"); expect(submissions).toBe(1);
});

test("leaves unknown extracted facts blank and preserves manual fields when switching methods", async ({ page }) => {
  await page.route(endpoint + "/api/extract", route => route.fulfill({ json: { draft: { ...draft(), year: null, deadline: null, timezone: null, tags: [] } } }));
  await open(page, true, "url");
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.locator("#add-venue-dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.locator("#venue-url").fill("https://conference.org/cfp"); await page.locator("#venue-extract").click();
  await expect(page.locator("#venue-draft-notice")).toContainText("year, deadline, timezone");
  await expect(page.locator('[name="year"]')).toHaveValue(""); await expect(page.locator('[name="deadline"]')).toHaveValue("");
  await page.locator('[name="name"]').fill("Edited draft");
  await page.locator('#venue-methods [value="manual"]').check();
  await expect(page.locator('[name="name"]')).toHaveValue("Edited draft");
  await page.locator('#venue-methods [value="url"]').check();
  await expect(page.locator('[name="name"]')).toHaveValue("Edited draft");
  await page.locator("#venue-different-url").click();
  await expect(page.locator("#venue-url")).toBeFocused();
  await expect(page.locator("#venue-details")).not.toBeVisible();
});

test("handles parsing errors and malicious drafts safely and keeps manual entry usable", async ({ page }) => {
  let calls = 0;
  await page.route(endpoint + "/api/extract", route => {
    calls++;
    return route.fulfill(calls === 1 ? { status: 429, json: { error: "Today's shared limit of ten URL lookups is reached." } } : { json: { draft: { ...draft(), name: '<img src=x onerror="window.injected=true">' } } });
  });
  await open(page, true, "url");
  await page.locator("#venue-url").fill("https://127.0.0.1/"); await page.locator("#venue-extract").click();
  await expect(page.locator("#venue-status")).toContainText("public domain"); expect(calls).toBe(0);
  await page.locator("#venue-url").fill("https://conference.org/cfp"); await page.locator("#venue-extract").click();
  await expect(page.locator("#venue-status")).toContainText("limit of ten");
  await page.locator("#venue-extract").click();
  await expect(page.locator("#venue-status")).toContainText("safe venue fields");
  expect(await page.evaluate(() => Boolean(window.injected))).toBe(false);
  await page.locator('#venue-methods [value="manual"]').check(); await fill(page);
  await expect(page.locator("#venue-submit")).toBeEnabled();
});

test("falls back to manual entry when parsing is unavailable", async ({ page }) => {
  await open(page, true, "manual", false);
  await expect(page.locator('#venue-methods [value="url"]')).toBeDisabled();
  await expect(page.locator("#venue-status")).toContainText("Enter the venue details manually");
  await fill(page); await expect(page.locator("#venue-submit")).toBeEnabled();
});

test("rejects unsafe input locally and preserves fields when daily cap is reached", async ({ page }) => {
  let requests = 0;
  await page.route(endpoint + "/api/submissions", route => { requests++; return route.fulfill({ status: 429, json: { error: "The shared limit of five venues for today is reached." } }); });
  await open(page); await fill(page);
  await page.locator('[name="name"]').fill("<script>");
  await page.locator("#venue-submit").click();
  await expect(page.locator("#venue-status")).toContainText("plain text");
  expect(requests).toBe(0);
  await page.locator('[name="name"]').fill("Example S&P");
  await page.locator("#venue-submit").click();
  await expect(page.locator("#venue-status")).toContainText("limit of five");
  await expect(page.locator('[name="name"]')).toHaveValue("Example S&P");
  await expect(page.locator("#venue-submit")).toBeEnabled();
  expect(requests).toBe(1);
});

test("rejects a forged PR link and retains a receipt after a lost response", async ({ page }) => {
  await page.route(endpoint + "/api/submissions", route => route.abort());
  await page.route(endpoint + "/api/status?**", route => route.fulfill({ json: { status: "created", prUrl: "https://attacker.org/pull/1" } }));
  await open(page); await fill(page); await page.locator("#venue-submit").click();
  await expect(page.locator("#venue-status")).toContainText("connection was interrupted");
  await page.locator("#venue-check").click();
  await expect(page.locator("#venue-pr-link")).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("sec-deadlines:venue-submission:v1")).receipt)).toMatch(/^[0-9a-f]{64}$/);
});

test("keeps form disabled when backend is not ready", async ({ page }) => {
  await open(page, false);
  await expect(page.locator("#venue-status")).toContainText("temporarily unavailable");
  await expect(page.locator("#venue-submit")).toBeDisabled();
});

test("explains setup state when no production endpoint is configured", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => document.getElementById("add-venue-dialog").dataset.api = "");
  await page.locator("#add-venue-btn").click();
  await expect(page.locator("#venue-status")).toHaveText("Venue submissions are being set up. Please try again later.");
  await expect(page.locator("#venue-submit")).toBeDisabled();
});
