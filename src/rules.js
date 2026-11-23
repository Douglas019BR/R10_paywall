// Loads and caches the site rules bundled with the extension.

let cache = null;

export async function loadRules() {
  if (cache) return cache;
  const res = await fetch(chrome.runtime.getURL("rules/sites.json"));
  if (!res.ok) throw new Error(`Failed to load rules: HTTP ${res.status}`);
  const data = await res.json();
  cache = Array.isArray(data) ? data : [];
  return cache;
}
