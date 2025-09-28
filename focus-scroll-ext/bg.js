// === Focus Scroll Watcher — background (MV3 service worker) ===

const DEFAULTS = {
  PWA_URL: "https://YOUR-APP-URL/?action=focus",
  COOLDOWN_MS: 45_000,
  OPEN_BEHAVIOR: "focus-or-open",     // "focus-or-open" | "open-new"
  BURST_WINDOW_MS: 1000,
  BURST_THRESHOLD: 12,
  IGNORE_SAME_ORIGIN_PWA: true,
  ENABLED: true,
  PAUSED_UNTIL: null                  // epoch ms or null
};

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}
async function setSettings(next) {
  const current = await getSettings();
  const merged = { ...current, ...next };
  await chrome.storage.sync.set({ settings: merged });
  await updateBadge(merged);
  return merged;
}

function isPaused(cfg) {
  if (!cfg.ENABLED) return true;
  if (cfg.PAUSED_UNTIL && Date.now() < cfg.PAUSED_UNTIL) return true;
  return false;
}

async function updateBadge(cfg) {
  const paused = isPaused(cfg);
  const text = paused ? "⏸" : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: paused ? "#ef4444" : "#3b82f6" });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get("settings");
  if (!settings) await chrome.storage.sync.set({ settings: DEFAULTS });
  await updateBadge(await getSettings());
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.settings) {
    await updateBadge(changes.settings.newValue || DEFAULTS);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "get-config") {
      const cfg = await getSettings();
      sendResponse({
        pwaUrl: cfg.PWA_URL,
        burstWindowMs: cfg.BURST_WINDOW_MS,
        burstThreshold: cfg.BURST_THRESHOLD,
        ignoreSameOriginPWA: cfg.IGNORE_SAME_ORIGIN_PWA,
        enabled: cfg.ENABLED,
        pausedUntil: cfg.PAUSED_UNTIL,
        cooldownMs: cfg.COOLDOWN_MS,
        openBehavior: cfg.OPEN_BEHAVIOR
      });
      return;
    }

    if (msg.type === "save-config") {
      const saved = await setSettings(msg.payload || {});
      sendResponse({ ok: true, saved });
      return;
    }

    if (msg.type === "set-enabled") {
      const saved = await setSettings({ ENABLED: !!msg.enabled, PAUSED_UNTIL: null });
      sendResponse({ ok: true, saved });
      return;
    }

    if (msg.type === "pause-for") {
      const ms = Math.max(0, Number(msg.ms || 0));
      const until = ms ? (Date.now() + ms) : null;
      const saved = await setSettings({ PAUSED_UNTIL: until });
      sendResponse({ ok: true, saved });
      return;
    }

    if (msg.type === "resume-now") {
      const saved = await setSettings({ PAUSED_UNTIL: null, ENABLED: true });
      sendResponse({ ok: true, saved });
      return;
    }

    if (msg.type === "rapid-scroll") {
      const cfg = await getSettings();
      if (isPaused(cfg)) return;

      const now = Date.now();
      const last = (self.__lastNudgeAt || 0);
      if (now - last < cfg.COOLDOWN_MS) return;
      self.__lastNudgeAt = now;

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon-128.png",
        title: "Focus check",
        message: "Rapid scrolling detected. Ready to refocus?",
        priority: 1
      });

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
  return true; // async response
});
