import { sanitizeDocument } from "./sanitize.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "R10_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "R10_SANITIZE") return false;

  try {
    const doc = new DOMParser().parseFromString(message.html, "text/html");
    sanitizeDocument(doc, { baseUrl: message.url, rules: message.rules || [] });
    sendResponse({ ok: true, html: "<!doctype html>\n" + doc.documentElement.outerHTML });
  } catch (err) {
    sendResponse({ ok: false, error: String(err?.message || err) });
  }
  return false;
});
