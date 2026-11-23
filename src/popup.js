const urlEl = document.getElementById("url");
const statusEl = document.getElementById("status");
const readNewTab = document.getElementById("read-newtab");
const readInPlace = document.getElementById("read-inplace");

let currentTab = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  urlEl.textContent = tab?.url || "No active tab";
  if (!tab?.url) {
    readNewTab.disabled = true;
    readInPlace.disabled = true;
  }
}

function setStatus(message, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function read(mode) {
  if (!currentTab?.id || !currentTab?.url) return;
  if (!/^https?:/i.test(currentTab.url)) {
    setStatus("This page can't be read (only http/https URLs).", true);
    return;
  }

  readNewTab.disabled = true;
  readInPlace.disabled = true;
  setStatus(mode === "inplace" ? "Rewriting this tab…" : "Fetching and cleaning…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "R10_READ",
      url: currentTab.url,
      mode,
      tabId: currentTab.id,
    });

    if (result?.ok) {
      setStatus(mode === "inplace" ? "Done — enjoy the article." : "Opened in a clean tab.");
      if (mode === "newtab") window.close();
    } else {
      setStatus(result?.error || "Something went wrong.", true);
    }
  } catch (err) {
    setStatus(String(err?.message || err), true);
  } finally {
    readNewTab.disabled = false;
    readInPlace.disabled = false;
  }
}

readNewTab.addEventListener("click", () => read("newtab"));
readInPlace.addEventListener("click", () => read("inplace"));

init();
