// === Focus Scroll Watcher — content script ===

const DEFAULTS = {
  burstWindowMs: 1000,
  burstThreshold: 12,
  ignoreSameOriginPWA: true,
  pwaUrl: "",
  enabled: true,
  pausedUntil: null
};

let CFG = { ...DEFAULTS };
let pwaOrigin = null;

function applyConfig(c) {
  CFG = { ...CFG, ...(c || {}) };
  try { pwaOrigin = CFG.pwaUrl ? new URL(CFG.pwaUrl).origin : null; } catch { pwaOrigin = null; }
}

function isPaused() {
  if (!CFG.enabled) return true;
  if (CFG.pausedUntil && Date.now() < CFG.pausedUntil) return true;
  return false;
}

// Load from storage first
chrome.storage.sync.get("settings", ({ settings }) => {
  if (settings) {
    applyConfig({
      pwaUrl: settings.PWA_URL,
      burstWindowMs: settings.BURST_WINDOW_MS,
      burstThreshold: settings.BURST_THRESHOLD,
      ignoreSameOriginPWA: settings.IGNORE_SAME_ORIGIN_PWA,
      enabled: settings.ENABLED,
      pausedUntil: settings.PAUSED_UNTIL
    });
  }
});

// Ask background too (authoritative)
chrome.runtime.sendMessage({ type: "get-config" }, (cfg) => { if (cfg) applyConfig(cfg); });

// Live updates from options/popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) {
    const s = changes.settings.newValue || {};
    applyConfig({
      pwaUrl: s.PWA_URL,
      burstWindowMs: s.BURST_WINDOW_MS,
      burstThreshold: s.BURST_THRESHOLD,
      ignoreSameOriginPWA: s.IGNORE_SAME_ORIGIN_PWA,
      enabled: s.ENABLED,
      pausedUntil: s.PAUSED_UNTIL
    });
  }
});

let count = 0, timer = null;
function bump() {
  if (isPaused()) return;
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
