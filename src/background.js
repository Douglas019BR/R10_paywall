import { findSiteRule } from "./sanitize.js";
import { loadRules } from "./rules.js";

let offscreenReady = false;
let nextUaRuleId = 1000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "R10_READ") {
    handleRead(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function handleRead({ url, mode = "newtab", tabId }) {
  if (!url) throw new Error("No URL provided");

  const rules = await loadRules();
  const site = findSiteRule(rules, url);
  const html = await withUserAgent(url, site?.userAgent, () => fetchRaw(url));

  const output = await sanitizeHtml(html, url, rules);

  if (mode === "inplace" && tabId != null) {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [output],
      func: (html) => {
        document.open();
        document.write(html);
        document.close();
      },
    });
    return { ok: true, mode: "inplace" };
  }

  const objectUrl = toDataUrl(output);
  const tab = await chrome.tabs.create({ url: objectUrl, active: true });
  return { ok: true, mode: "newtab", tabId: tab.id };
}

// Build a data: URL from HTML. `URL.createObjectURL`/`Blob` are unavailable in
// the service worker, so we encode UTF-8 bytes to base64 ourselves.
function toDataUrl(html) {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return "data:text/html;charset=utf-8;base64," + btoa(binary);
}

// Some sites (e.g. Forbes) return 403 to a normal browser User-Agent but serve
// the full article to a "tool" UA like `curl`. `fetch()` cannot set the
// User-Agent header, so we install a temporary session declarativeNetRequest
// rule scoped to the target host, run the fetch, then remove the rule.
async function withUserAgent(url, userAgent, fn) {
  if (!userAgent) return fn();
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return fn();
  }

  // A unique id per invocation so concurrent reads to different sites never
  // overwrite or remove each other's session rule.
  const ruleId = nextUaRuleId++;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: ruleId,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "user-agent", operation: "set", value: userAgent }],
          },
          condition: {
            requestDomains: [host],
            resourceTypes: ["xmlhttprequest"],
          },
        },
      ],
    });
  } catch {
    return fn();
  }

  try {
    return await fn();
  } finally {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    } catch {
      // ignore cleanup failures
    }
  }
}

// DOMParser is not available in MV3 service workers, so the sanitizer runs in
// an offscreen document (which has a full DOM). We fetch here (so we can omit
// cookies and spoof the User-Agent), then hand the raw HTML off for parsing.
async function sanitizeHtml(html, url, rules) {
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({ type: "R10_SANITIZE", html, url, rules });
  if (!result?.ok) throw new Error(result?.error || "Sanitization failed");
  return result.html;
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  let exists = false;
  try {
    exists = await chrome.offscreen.hasDocument();
  } catch {
    // hasDocument may not exist on older Chrome versions
  }
  if (!exists) {
    try {
      await chrome.offscreen.createDocument({
        url: "src/offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Parse and sanitize fetched HTML; DOMParser is unavailable in the service worker",
      });
    } catch (err) {
      // The document may already exist from a previous service worker lifetime.
      if (!String(err?.message).includes("single offscreen document")) throw err;
    }
  }
  await waitForOffscreen();
}

// createDocument() resolves when the document is created, not when its script
// has registered the onMessage listener. Ping until the offscreen doc answers,
// so a cold-start R10_SANITIZE can't race script registration.
async function waitForOffscreen() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "R10_PING" });
      if (res?.ok) {
        offscreenReady = true;
        return;
      }
    } catch {
      // listener not registered yet
    }
    await sleep(50);
  }
  throw new Error("Offscreen document did not become ready");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch the raw HTML without cookies — the same thing `curl` does by default.
// Omitting cookies matters: the server cannot tell we already hit the meter,
// so it serves the full (un-metered) document.
async function fetchRaw(url) {
  const res = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}
