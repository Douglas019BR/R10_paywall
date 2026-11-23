// R10 Paywall — HTML sanitizer.
//
// The idea mirrors the manual workflow of fetching the raw HTML with `curl`
// and opening it in a local server: the full article is almost always present
// in the HTML, but the *client-side* paywall hides it with scripts, overlays
// and CSS. This module removes the pieces that enforce the paywall and
// rewrites relative URLs so the result is a readable, standalone page.
//
// `sanitizeDocument` works on any DOM `Document` (the service worker passes
// one from `DOMParser`, the tests pass one from `jsdom`), so it has no
// browser-global dependencies beyond the standard DOM API.

const URL_ATTRS = {
  a: ["href"],
  img: ["src", "srcset", "data-src", "data-original", "data-lazy-src"],
  link: ["href"],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  iframe: ["src"],
  form: ["action"],
  embed: ["src"],
  track: ["src"],
  input: ["src"],
};

// NOTE: lowercase tag names. CSS type selectors match HTML elements
// case-insensitively but SVG elements case-sensitively, so "script" is required
// to also catch <svg><script>…</script></svg> (which "SCRIPT" would miss).
const REMOVE_TAGS = new Set([
  "script",
  "iframe",
  "form",
  "noscript",
  "object",
  "embed",
  "applet",
]);

// Tokens (matched as whole words against class/id/name/data-testid) that
// strongly suggest a paywall/overlay/cookie element. Kept deliberately
// conservative; site-specific rules can be more aggressive.
//
// "premium" is intentionally absent: it too often labels the article itself
// (e.g. "premium-article-body") rather than the paywall.
const GENERIC_HIDE_HINTS = [
  "paywall",
  "pay-wall",
  "subscription",
  "subscribe",
  "regwall",
  "hardwall",
  "softwall",
  "login-wall",
  "signup-wall",
  "metered",
  "meter",
  "gate",
  "gateway",
  "locked",
  "modal",
  "overlay",
  "lightbox",
  "interstitial",
  "cookie",
  "gdpr",
  "consent",
  "newsletter",
  "adblock",
];

// Boundary-aware matchers, one per hint. A hint only matches when it is a
// whole token (surrounded by non-alphanumerics), never a substring — so
// "gate" does not match "delegate", "meter" does not match "diameter" or
// "parameters", and "locked" does not match "unlocked".
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HINT_PATTERNS = GENERIC_HIDE_HINTS.map(
  (hint) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(hint)}([^a-z0-9]|$)`),
);

// Lowercase and split camelCase ("PaywallOverlay" -> "paywall overlay") so the
// boundary regex also matches hints at camelCase transitions.
function normalizeHintText(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function hasHideHint(value) {
  const normalized = normalizeHintText(value);
  return HINT_PATTERNS.some((re) => re.test(normalized));
}

// A single CSS declaration that hides content.
const HIDE_DECL_RE =
  /^(display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|opacity\s*:\s*0(?![\d.])|height\s*:\s*0(?![\d.])|max-height\s*:\s*0(?![\d.])|filter\s*:\s*blur)/i;

// A single CSS declaration that locks page scroll (only relevant on html/body).
const OVERFLOW_HIDE_RE = /^overflow\s*:\s*hidden/i;

// Class tokens that hide content when present.
const HIDE_CLASS_RE = /(^|[\s_-])(d-none|hidden|invisible|hide|blur|collapse)([\s_-]|$)/i;

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/**
 * Resolve a possibly-relative URL against `baseUrl`. Fragments and values that
 * cannot be parsed are returned unchanged.
 */
export function absolutize(raw, baseUrl) {
  if (!raw || !baseUrl) return raw;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("data:")) return raw;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return raw;
  }
}

function rewriteSrcset(value, baseUrl) {
  if (!value) return value;
  // NOTE: splits on "," which does not honor commas inside `data:` URLs
  // (e.g. "data:image/svg+xml,%3csvg…,x 1x"). Rare in practice; if it matters,
  // replace with a parser that respects data: URLs and CSS url().
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const idx = trimmed.search(/\s/);
      if (idx === -1) return absolutize(trimmed, baseUrl);
      const url = trimmed.slice(0, idx);
      const descriptor = trimmed.slice(idx);
      return `${absolutize(url, baseUrl)}${descriptor}`;
    })
    .join(", ");
}

function rewriteCssUrls(text, baseUrl) {
  if (!text) return text;
  return text.replace(CSS_URL_RE, (_m, quote, url) => {
    const abs = absolutize(url.trim(), baseUrl);
    return `url(${quote}${abs}${quote})`;
  });
}

function matchesHost(patterns, host) {
  if (!Array.isArray(patterns) || !host) return false;
  return patterns.some((p) => {
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // ".example.com"
      return host === p.slice(2) || host.endsWith(suffix);
    }
    return host === p;
  });
}

function querySelectorAllSafe(doc, selector) {
  if (!selector) return [];
  try {
    return [...doc.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

/**
 * Return the site rule (if any) whose `hostnames` match the host of `baseUrl`.
 * Exported so the background worker can read per-site options (e.g. userAgent).
 */
export function findSiteRule(rules, baseUrl) {
  if (!baseUrl || !Array.isArray(rules)) return null;
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return null;
  }
  return rules.find((r) => matchesHost(r.hostnames, host)) || null;
}

function stripHidingDeclarations(styleText, extra) {
  const decls = String(styleText || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = decls.filter((decl) => {
    if (HIDE_DECL_RE.test(decl)) return false;
    if (extra && OVERFLOW_HIDE_RE.test(decl)) return false;
    return true;
  });
  return kept.join("; ");
}

/**
 * Sanitize `doc` in place. Returns the `Document` for convenience.
 *
 * @param {Document} doc
 * @param {{baseUrl?: string, rules?: object[]}} [opts]
 */
export function sanitizeDocument(doc, { baseUrl = "", rules = [] } = {}) {
  const site = findSiteRule(rules, baseUrl);
  const siteRules = {
    removeSelectors: Array.isArray(site?.removeSelectors) ? site.removeSelectors : [],
    keepSelectors: Array.isArray(site?.keepSelectors) ? site.keepSelectors : [],
  };

  const keepSelector = siteRules.keepSelectors.join(",") || null;
  const keep = new Set(keepSelector ? querySelectorAllSafe(doc, keepSelector) : []);

  const isKeep = (el) => keep.has(el);
  const containsKeep = (el) => keep.size > 0 && [...keep].some((k) => el.contains(k));

  // 1. Remove elements that enforce the paywall.
  for (const tag of REMOVE_TAGS) {
    for (const el of doc.querySelectorAll(tag)) el.remove();
  }

  // 2. Remove site-specific and heuristic paywall elements (skip anything
  //    that is, or contains, a protected "keep" element).
  const removeSelector = siteRules.removeSelectors.join(",") || null;
  const candidates = [];
  if (removeSelector) candidates.push(...querySelectorAllSafe(doc, removeSelector));

  for (const el of doc.querySelectorAll("*")) {
    const hint = [el.getAttribute("class"), el.getAttribute("id"), el.getAttribute("name"), el.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ");
    if (hint && hasHideHint(hint)) candidates.push(el);
  }

  for (const el of candidates) {
    if (isKeep(el) || containsKeep(el)) continue;
    if (el === doc.documentElement || el === doc.body || el === doc.head) continue;
    el.remove();
  }

  // 3. Reveal content: strip attributes/styles/classes that hide it.
  for (const el of doc.querySelectorAll("*")) {
    if (el.hasAttribute("hidden")) el.removeAttribute("hidden");
    if (el.hasAttribute("aria-hidden")) el.removeAttribute("aria-hidden");
    if (el.hasAttribute("inert")) el.removeAttribute("inert");

    const isRoot = el === doc.body || el === doc.documentElement;
    const style = el.getAttribute("style");
    if (style) {
      const cleaned = stripHidingDeclarations(style, isRoot);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    }

    const cls = el.getAttribute("class");
    if (cls) {
      const tokens = cls.split(/\s+/).filter((t) => t && !HIDE_CLASS_RE.test(t));
      if (tokens.length) el.setAttribute("class", tokens.join(" "));
      else el.removeAttribute("class");
    }
  }

  // 4. Strip inline event handlers and javascript: URLs (scripts are gone).
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      if (attr.name === "href" && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }

  // 5. Rewrite relative resource URLs to absolute.
  for (const [tag, attrs] of Object.entries(URL_ATTRS)) {
    for (const el of doc.querySelectorAll(tag)) {
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const next = attr === "srcset" ? rewriteSrcset(value, baseUrl) : absolutize(value, baseUrl);
        if (next !== value) el.setAttribute(attr, next);
      }
    }
  }

  // 6. Rewrite CSS url() references in inline styles and <style> blocks.
  for (const el of doc.querySelectorAll("[style]")) {
    const style = el.getAttribute("style");
    el.setAttribute("style", rewriteCssUrls(style, baseUrl));
  }
  for (const style of doc.querySelectorAll("style")) {
    style.textContent = rewriteCssUrls(style.textContent, baseUrl);
  }

  // 7. Remove meta refresh redirects.
  for (const meta of doc.querySelectorAll('meta[http-equiv="refresh"]')) meta.remove();

  // 8. Add a small attribution banner.
  addBanner(doc, baseUrl);

  return doc;
}

function addBanner(doc, baseUrl) {
  if (!doc.body) return;
  const banner = doc.createElement("div");
  banner.setAttribute("data-r10-paywall", "1");
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "background:#111827",
    "color:#e5e7eb",
    "font:12px/1.4 system-ui,sans-serif",
    "padding:8px 12px",
    "display:flex",
    "gap:12px",
    "align-items:center",
  ].join(";");

  const label = doc.createElement("span");
  label.textContent = "Cleaned by R10 Paywall";

  banner.appendChild(label);

  if (baseUrl) {
    const link = doc.createElement("a");
    link.textContent = "view original";
    link.href = baseUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "color:#93c5fd;text-decoration:underline;";
    banner.appendChild(link);
  }

  doc.body.prepend(banner);
}
