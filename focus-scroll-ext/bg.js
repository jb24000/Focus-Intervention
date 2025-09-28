// === Focus Scroll Watcher — background (MV3 service worker) ===

const DEFAULTS = {
  PWA_URL: "https://YOUR-APP-URL/?action=focus",
  COOLDOWN_MS: 45_000,
  OPEN_BEHAVIOR: "focus-or-open",     // "focus-or-open" | "open-new"
  BURST_WINDOW_MS: 1000,
  BURST_THRESHOLD: 12,
  IGNORE_SAME_ORIGIN_PWA: true
};

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}

async function setSettings(next) {
  const current = await getSettings();
  const merged = { ...current, ...next };
  await chrome.storage.sync.set({ settings: merged });
  return merged;
}

// Initialize defaults on install/upgrade if nothing saved yet
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get("settings");
  if (!settings) {
    await chrome.storage.sync.set({ settings: DEFAULTS });
  }
});

// Handle messages from content/options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "get-config") {
      const cfg = await getSettings();
      sendResponse({
        pwaUrl: cfg.PWA_URL,
        burstWindowMs: cfg.BURST_WINDOW_MS,
        burstThreshold: cfg.BURST_THRESHOLD,
        ignoreSameOriginPWA: cfg.IGNORE_SAME_ORIGIN_PWA
      });
      return;
    }
    if (msg.type === "save-config") {
      const saved = await setSettings(msg.payload || {});
      sendResponse({ ok: true, saved });
      return;
    }
    if (msg.type === "rapid-scroll") {
      const cfg = await getSettings();
      const now = Date.now();
      const last = (self.__lastNudgeAt || 0);
      if (now - last < cfg.COOLDOWN_MS) return;

      self.__lastNudgeAt = now;

      // Notify
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon-128.png",
        title: "Focus check",
        message: "Rapid scrolling detected. Ready to refocus?",
        priority: 1
      });

      // Open/focus the PWA
      if (cfg.OPEN_BEHAVIOR === "open-new") {
        chrome.tabs.create({ url: cfg.PWA_URL });
        return;
      }
      const base = cfg.PWA_URL.split("?")[0];
      chrome.tabs.query({}, (tabs) => {
        const existing = tabs.find(t => t.url && t.url.startsWith(base));
        if (existing) {
          chrome.tabs.update(existing.id, { active: true, url: cfg.PWA_URL });
        } else {
          chrome.tabs.create({ url: cfg.PWA_URL });
        }
      });
      return;
    }
  })();
  // Indicate we'll respond asynchronously
  return true;
});
