import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker.js";
import { extractVenue, fetchVenuePage, normalizeDraft, publicAddress, visibleText, EXTRACTION_MODEL } from "../src/extraction.js";

const source = "https://conference.org/cfp";
const year = new Date().getUTCFullYear() + 1;
const facts = () => ({ name: "ExampleConf", year, description: "Example Security Conference", date: `June ${year}`, place: "London, UK", timezone: "Etc/GMT+12", deadline: [`${year - 1}-12-01 23:59`], tags: ["SEC", "CONF"] });
const html = `<html><body><h1>ExampleConf ${year}</h1><p>Security Conference in London, UK during June ${year}.</p><p>Paper submission deadline December 1, ${year - 1}, 23:59 AoE.</p></body></html>`;
function external({ address = "93.184.215.14", page = html, verification = { success: true, action: "parse_venue", hostname: "alihamzamalik.me" }, redirect } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (String(url).includes("/siteverify")) return Response.json(verification);
    if (String(url).startsWith("https://cloudflare-dns.com/")) return Response.json({ Status: 0, Answer: String(url).includes("type=AAAA") ? [] : [{ type: 1, data: address }] });
    if (String(url) === source) return redirect ? new Response(null, { status: 302, headers: { Location: redirect } }) : new Response(page, { headers: { "Content-Type": "text/html" } });
    throw new Error(`Unexpected destination ${new URL(url).hostname}`);
  });
}
function config(ai) { return { ...env, EXTRACTION_ENABLED: "true", AI: ai, GITHUB_REPOSITORY: `test/${crypto.randomUUID()}`, REQUEST_LIMIT: { limit: async () => ({ success: true }) } }; }
function request(body = { url: source, turnstileToken: "test-challenge" }, ip = "198.51.100.20", headers = {}) {
  return new Request("https://worker.example/api/extract", { method: "POST", headers: { Origin: "https://alihamzamalik.me", "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
afterEach(() => vi.restoreAllMocks());

describe("safe page fetching", () => {
  it("rejects private, mapped, special-purpose and malformed addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "100.82.165.116", "169.254.169.254", "172.16.2.1", "192.168.1.1", "198.19.2.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::1", "2001:db8::1", "2001:1ff::1", "2002::1", "3fff::1", "2606:::1", "2606:4700"]) expect(publicAddress(address), address).toBe(false);
    for (const address of ["1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "2001:4860:4860:0:0:0:0:8888"]) expect(publicAddress(address), address).toBe(true);
  });

  it("does not contact a domain resolving to a private address", async () => {
    const spy = external({ address: "10.0.0.1" });
    await expect(fetchVenuePage(source)).rejects.toThrow("public Internet");
    expect(spy.mock.calls.every(([url]) => String(url).startsWith("https://cloudflare-dns.com/"))).toBe(true);
  });

  it("validates redirect destinations before fetching and bounds redirect loops", async () => {
    for (const redirect of ["https://127.0.0.1/", "http://conference.org/", "https://user:pass@conference.org/", "https://conference.local/"]) {
      const spy = external({ redirect });
      await expect(fetchVenuePage(source)).rejects.toThrow();
      expect(spy.mock.calls.filter(([url]) => !String(url).startsWith("https://cloudflare-dns.com/"))).toHaveLength(1);
      spy.mockRestore();
    }
    external({ redirect: source });
    await expect(fetchVenuePage(source)).rejects.toThrow("redirects too many");
  });

  it("rejects private DNS answers on redirected hosts", async () => {
    const spy = external({ redirect: "https://private.conference.org/cfp" });
    spy.mockImplementation(async url => {
      if (String(url).startsWith("https://cloudflare-dns.com/")) return Response.json({ Status: 0, Answer: [{ type: 1, data: String(url).includes("private.") ? "169.254.169.254" : "93.184.215.14" }] });
      if (String(url) === source) return new Response(null, { status: 302, headers: { Location: "https://private.conference.org/cfp" } });
      throw new Error("Private destination must not be fetched");
    });
    await expect(fetchVenuePage(source)).rejects.toThrow("public Internet");
    expect(spy.mock.calls.some(([url]) => String(url).startsWith("https://private."))).toBe(false);
  });

  it("bounds response bodies, rejects PDFs, and uses no visitor credentials", async () => {
    const spy = external({ page: "x".repeat(256001) });
    await expect(fetchVenuePage(source)).rejects.toThrow("too large");
    spy.mockRestore();
    external().mockImplementation(async url => String(url).includes("dns-query") ? Response.json({ Status: 0, Answer: [{ type: 1, data: "1.1.1.1" }] }) : new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }));
    await expect(fetchVenuePage(source)).rejects.toThrow("HTML or text");
    vi.restoreAllMocks();
    const normal = external(); await fetchVenuePage(source);
    expect(normal.mock.calls.filter(([url]) => String(url).includes("dns-query")).every(([, options]) => options.redirect === "manual")).toBe(true);
    const options = normal.mock.calls.find(([url]) => url === source)[1];
    expect(options.redirect).toBe("manual");
    expect(Object.keys(options.headers).sort()).toEqual(["Accept", "User-Agent"]);
  });

  it("removes executable and hidden content and bounds the model input", async () => {
    const text = await visibleText(`<h1>Readable venue</h1><script>SECRET SCRIPT</script><style>SECRET STYLE</style><div hidden>SECRET HIDDEN</div><nav>SECRET NAV</nav><p>Deadline &amp; location</p>`);
    expect(text).toContain("Readable venue"); expect(text).toContain("Deadline & location"); expect(text).not.toContain("SECRET");
    expect((await visibleText(`<p>${"a".repeat(20000)}</p>`)).length).toBeLessThanOrEqual(16000);
    external({ page: `<p>${"研".repeat(10000)}</p>` });
    expect(new TextEncoder().encode((await fetchVenuePage(source)).text).length).toBeLessThanOrEqual(16000);
  });
});

describe("untrusted model output", () => {
  it("returns an editable draft with unknown fields instead of invented defaults", () => {
    const result = normalizeDraft({ name: "ExampleConf", tags: [] }, source);
    expect(result.draft.year).toBeNull(); expect(result.draft.deadline).toBeNull(); expect(result.draft.timezone).toBeNull();
    expect(result.draft.source).toBe(source);
    expect(result.missingFields).toContain("publication type");
    expect(normalizeDraft({ ...facts(), timezone: null }, source).draft.deadline).toBeNull();
  });

  it("rejects injected fields, markup, invalid dates, timezones and rankings", () => {
    for (const change of [{ command: "run" }, { name: "<script>" }, { description: "{{site.title}}" }, { year: year - 5 }, { deadline: [`${year}-02-30 23:59`] }, { timezone: "../../etc" }, { tags: ["SEC", "CONF", "CORE-A"] }]) expect(() => normalizeDraft({ ...facts(), ...change }, source)).toThrow();
  });

  it("converts valid second precision to the existing minute format with a review notice", () => {
    const result = normalizeDraft({ ...facts(), deadline: [`${year - 1}-12-01 23:59:59`] }, source);
    expect(result.draft.deadline).toEqual([`${year - 1}-12-01 23:59`]);
    expect(result.warnings).toHaveLength(1);
    expect(() => normalizeDraft({ ...facts(), deadline: [`${year - 1}-12-01 23:59:99`] }, source)).toThrow();
    expect(() => normalizeDraft({ ...facts(), deadline: [`${year - 1}-02-30 23:59:59`] }, source)).toThrow();
  });

  it("makes exactly one bounded inference without tools or model-directed requests", async () => {
    external(); const ai = { run: vi.fn(async () => ({ response: JSON.stringify(facts()) })) };
    expect((await extractVenue(source, ai)).draft.name).toBe("ExampleConf");
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [model, options] = ai.run.mock.calls[0];
    expect(model).toBe(EXTRACTION_MODEL); expect(options.max_tokens).toBe(1200);
    expect(options.tools).toBeUndefined(); expect(options.response_format.type).toBe("json_schema");
    expect(options.messages[0].content).toContain("untrusted webpage");
  });

  it("fails safely on unavailable models and malformed or oversized output", async () => {
    external();
    await expect(extractVenue(source, { run: async () => { throw new Error("quota"); } })).rejects.toThrow("unavailable");
    for (const response of ["not json", "x".repeat(6001), null]) await expect(extractVenue(source, { run: async () => ({ response }) })).rejects.toThrow();
  });
});

describe("independent durable extraction quota", () => {
  it("atomically caps per-network lookups and survives eviction without using PR slots", async () => {
    const stub = env.SUBMISSIONS.get(env.SUBMISSIONS.newUniqueId());
    const results = await Promise.all(Array.from({ length: 20 }, () => stub.reserveExtraction("daily-hashed-network")));
    expect(results.filter(result => result.accepted)).toHaveLength(3);
    await evictDurableObject(stub);
    expect((await stub.reserveExtraction("daily-hashed-network")).reason).toBe("visitor_limit");
    const more = await Promise.all(Array.from({ length: 20 }, (_, i) => stub.reserveExtraction(`other-${i}`)));
    expect(more.filter(result => result.accepted)).toHaveLength(7);
    expect((await stub.reserve("id", "receipt", "fingerprint", "venue", {})).accepted).toBe(true);
    await runDurableObjectAlarm(stub);
    expect((await stub.reserveExtraction("daily-hashed-network")).accepted).toBe(true);
  });

  it("rejects unsafe requests and wrong bot actions before fetching pages or calling models", async () => {
    const ai = { run: vi.fn() }, cfg = config(ai), spy = external();
    for (const body of [{ url: "https://127.0.0.1", turnstileToken: "test" }, { url: source, turnstileToken: "" }, { url: source, turnstileToken: "test", extra: true }, "{"]) expect((await worker.fetch(request(body), cfg)).status).toBe(400);
    expect((await worker.fetch(request("x".repeat(3001)), cfg)).status).toBe(413);
    expect((await worker.fetch(request(undefined, undefined, { Origin: "https://attacker.org" }), cfg)).status).toBe(403);
    expect((await worker.fetch(request(undefined, undefined, { "Content-Type": "text/plain" }), cfg)).status).toBe(415);
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
    external({ verification: { success: true, action: "add_venue", hostname: "alihamzamalik.me" } });
    expect((await worker.fetch(request(), cfg)).status).toBe(403); expect(ai.run).not.toHaveBeenCalled();
  });

  it("returns safe drafts, enforces global HTTP quota, and never dispatches GitHub", async () => {
    const spy = external(), ai = { run: vi.fn(async () => ({ response: facts() })) }, cfg = config(ai);
    const responses = await Promise.all(Array.from({ length: 16 }, (_, i) => worker.fetch(request(undefined, `network-${i}`), cfg)));
    expect(responses.filter(response => response.status === 200)).toHaveLength(10);
    expect(responses.filter(response => response.status === 429)).toHaveLength(6);
    expect(ai.run).toHaveBeenCalledTimes(10);
    expect((await responses.find(response => response.status === 200).json()).draft.name).toBe("ExampleConf");
    expect(spy.mock.calls.some(([url]) => String(url).includes("github.com"))).toBe(false);
  });

  it("retains failed lookup reservations and leaves the manual endpoint available", async () => {
    external({ address: "10.0.0.1" }); const cfg = config({ run: vi.fn() });
    for (let i = 0; i < 3; i++) expect((await worker.fetch(request(), cfg)).status).toBe(400);
    expect((await worker.fetch(request(), cfg)).status).toBe(429);
    expect((await worker.fetch(request(), { ...cfg, EXTRACTION_ENABLED: "false" })).status).toBe(503);
    const manual = new Request("https://worker.example/api/config", { headers: { Origin: "https://alihamzamalik.me" } });
    expect(await (await worker.fetch(manual, { ...cfg, AI: undefined })).json()).toMatchObject({ enabled: true, extractionEnabled: false, dailyLimit: 5 });
  });
});
