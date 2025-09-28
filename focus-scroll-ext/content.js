// === Focus Scroll Watcher — content script ===
// Detects "rapid scroll bursts" and informs background.
// Reads settings from storage; updates live when options change.

const DEFAULTS = {
  burstWindowMs: 1000,
  burstThreshold: 12,
  ignoreSameOriginPWA: true,
  pwaUrl: ""
};

let CFG = { ...DEFAULTS };
let pwaOrigin = null;

function applyConfig(c) {
  CFG = { ...CFG, ...(c || {}) };
  try { pwaOrigin = CFG.pwaUrl ? new URL(CFG.pwaUrl).origin : null; } catch { pwaOrigin = null; }
}

// Load settings initially from storage
chrome.storage.sync.get("settings", ({ settings }) => {
  if (settings) {
    applyConfig({
      pwaUrl: settings.PWA_URL,
      burstWindowMs: settings.BURST_WINDOW_MS,
      burstThreshold: settings.BURST_THRESHOLD,
      ignoreSameOriginPWA: settings.IGNORE_SAME_ORIGIN_PWA
    });
  }
});

// Also ask background (in case service worker has newer state)
chrome.runtime.sendMessage({ type: "get-config" }, (cfg) => {
  if (cfg) applyConfig(cfg);
});

// React to changes from Options page in real time (new tabs keep current values)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) {
    const s = changes.settings.newValue || {};
    applyConfig({
      pwaUrl: s.PWA_URL,
      burstWindowMs: s.BURST_WINDOW_MS,
      burstThreshold: s.BURST_THRESHOLD,
      ignoreSameOriginPWA: s.IGNORE_SAME_ORIGIN_PWA
    });
  }
});

// Burst detector
let count = 0, timer = null;
function bump() {
  if (CFG.ignoreSameOriginPWA && pwaOrigin && location.origin === pwaOrigin) return;

  count++;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (count > CFG.burstThreshold) {
      chrome.runtime.sendMessage({ type: "rapid-scroll", url: location.href, ts: Date.now() });
    }
    count = 0;
  }, CFG.burstWindowMs);
}

["wheel", "scroll", "touchmove"].forEach(evt =>
  addEventListener(evt, bump, { passive: true })
);
