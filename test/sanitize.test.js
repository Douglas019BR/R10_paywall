import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sanitizeDocument, absolutize, findSiteRule } from "../src/sanitize.js";

function clean(html, baseUrl = "https://example.com/article/123") {
  const dom = new JSDOM(html);
  sanitizeDocument(dom.window.document, { baseUrl, rules: [] });
  return dom.window.document;
}

test("absolutize resolves relative, absolute and protocol-relative URLs", () => {
  assert.equal(absolutize("/img/x.png", "https://example.com/a/b"), "https://example.com/img/x.png");
  assert.equal(absolutize("img/x.png", "https://example.com/a/b"), "https://example.com/a/img/x.png");
  assert.equal(absolutize("https://cdn.com/x.png", "https://example.com/a"), "https://cdn.com/x.png");
  assert.equal(absolutize("//cdn.com/x.png", "https://example.com/a"), "https://cdn.com/x.png");
  assert.equal(absolutize("#frag", "https://example.com/a"), "#frag");
  assert.equal(absolutize("data:image/png;base64,x", "https://example.com/a"), "data:image/png;base64,x");
});

test("removes scripts and paywall overlays", () => {
  const doc = clean(`
    <html><head><script>alert(1)</script></head><body>
      <div id="app"></div>
      <div class="paywall-overlay">Please subscribe</div>
      <div class="article">Full article text</div>
    </body></html>
  `);
  assert.equal(doc.querySelector("script"), null);
  assert.equal(doc.querySelector(".paywall-overlay"), null);
  assert.ok(doc.querySelector(".article"));
});

test("removes SVG-namespace scripts (lowercase tag selector)", () => {
  const doc = clean(`
    <body>
      <svg><script>alert(1)</script></svg>
      <svg><foreignObject><script>alert(2)</script></foreignObject></svg>
      <p>content</p>
    </body>
  `);
  assert.equal(doc.querySelectorAll("script").length, 0);
});

test("hide hints match whole tokens, not substrings", () => {
  const doc = clean(`
    <body>
      <div class="delegate">keep</div>
      <div class="diameter">keep</div>
      <div class="search-parameters">keep</div>
      <div class="unlocked">keep</div>
      <div class="premium-article-body">keep the article</div>
      <div class="paywall-overlay">remove</div>
      <div class="PaywallOverlay">remove</div>
    </body>
  `);
  assert.ok(doc.querySelector(".delegate"));
  assert.ok(doc.querySelector(".diameter"));
  assert.ok(doc.querySelector(".search-parameters"));
  assert.ok(doc.querySelector(".unlocked"));
  assert.ok(doc.querySelector(".premium-article-body"));
  assert.equal(doc.querySelector(".paywall-overlay"), null);
  assert.equal(doc.querySelector(".PaywallOverlay"), null);
});


test("reveals content hidden by inline style", () => {
  const doc = clean(`
    <body>
      <div id="content" style="display:none; color:red">Hidden article</div>
    </body>
  `);
  const el = doc.querySelector("#content");
  assert.equal(el.getAttribute("style"), "color:red");
});

test("removes hidden and aria-hidden attributes", () => {
  const doc = clean(`<body><p hidden aria-hidden="true">Hi</p></body>`);
  const el = doc.querySelector("p");
  assert.equal(el.hasAttribute("hidden"), false);
  assert.equal(el.hasAttribute("aria-hidden"), false);
});

test("rewrites relative resource URLs to absolute", () => {
  const doc = clean(`
    <body>
      <img src="/img/a.jpg" />
      <img srcset="/img/a.jpg 1x, /img/b.jpg 2x" />
      <link rel="stylesheet" href="/styles.css" />
    </body>
  `);
  assert.equal(doc.querySelector("img").getAttribute("src"), "https://example.com/img/a.jpg");
  const srcset = doc.querySelectorAll("img")[1].getAttribute("srcset");
  assert.ok(srcset.startsWith("https://example.com/img/a.jpg"));
  assert.equal(doc.querySelector("link").getAttribute("href"), "https://example.com/styles.css");
});

test("keeps elements protected by keepSelectors", () => {
  const dom = new JSDOM(`
    <body>
      <div class="paywall"><div class="article-content">Protected article</div></div>
    </body>
  `);
  sanitizeDocument(dom.window.document, {
    baseUrl: "https://example.com/",
    rules: [{ hostnames: ["example.com"], keepSelectors: [".article-content"] }],
  });
  assert.ok(dom.window.document.querySelector(".article-content"));
});

test("strips inline event handlers and javascript: links", () => {
  const doc = clean(`
    <body>
      <a id="evil" href="javascript:void(0)" onclick="steal()">click</a>
    </body>
  `);
  const a = doc.querySelector("#evil");
  assert.equal(a.hasAttribute("href"), false);
  assert.equal(a.hasAttribute("onclick"), false);
});

test("adds a banner pointing back to the original URL", () => {
  const doc = clean(`<body><p>hi</p></body>`);
  const banner = doc.querySelector("[data-r10-paywall]");
  assert.ok(banner);
  assert.equal(banner.querySelector("a")?.getAttribute("href"), "https://example.com/article/123");
});

test("findSiteRule matches hostnames including wildcard subdomains", () => {
  const rules = [{ name: "Forbes", hostnames: ["*.forbes.com", "forbes.com"], userAgent: "curl/8.0" }];
  assert.equal(findSiteRule(rules, "https://www.forbes.com/a/b")?.userAgent, "curl/8.0");
  assert.equal(findSiteRule(rules, "https://forbes.com/x")?.name, "Forbes");
  assert.equal(findSiteRule(rules, "https://example.com/"), null);
});
