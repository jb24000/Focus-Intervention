const DEFAULTS = {
  PWA_URL: "https://YOUR-APP-URL/?action=focus",
  COOLDOWN_MS: 45_000,
  OPEN_BEHAVIOR: "focus-or-open",
  BURST_WINDOW_MS: 1000,
  BURST_THRESHOLD: 12,
  IGNORE_SAME_ORIGIN_PWA: true
};

const $ = (id) => document.getElementById(id);
const savedBadge = $("saved");

function showSaved() {
  savedBadge.style.visibility = "visible";
  setTimeout(() => savedBadge.style.visibility = "hidden", 1200);
}

function applyToForm(s) {
  $("pwaUrl").value = s.PWA_URL || DEFAULTS.PWA_URL;
  $("openBehavior").value = s.OPEN_BEHAVIOR || DEFAULTS.OPEN_BEHAVIOR;
  $("burstThreshold").value = s.BURST_THRESHOLD ?? DEFAULTS.BURST_THRESHOLD;
  $("burstWindowMs").value = s.BURST_WINDOW_MS ?? DEFAULTS.BURST_WINDOW_MS;
  $("ignoreSameOriginPwa").checked = (s.IGNORE_SAME_ORIGIN_PWA ?? DEFAULTS.IGNORE_SAME_ORIGIN_PWA);
  $("cooldownMs").value = s.COOLDOWN_MS ?? DEFAULTS.COOLDOWN_MS;
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  applyToForm({ ...DEFAULTS, ...(settings || {}) });
}

function readForm() {
  let url = $("pwaUrl").value.trim();
  // Simple URL guard; allow localhost too
  try { if (url) new URL(url); } catch {
    alert("Please enter a valid URL (including https:// or http:// for localhost).");
    throw new Error("Invalid URL");
  }
  return {
    PWA_URL: url || DEFAULTS.PWA_URL,
    OPEN_BEHAVIOR: $("openBehavior").value || DEFAULTS.OPEN_BEHAVIOR,
    BURST_THRESHOLD: Math.max(1, parseInt($("burstThreshold").value || DEFAULTS.BURST_THRESHOLD, 10)),
    BURST_WINDOW_MS: Math.max(100, parseInt($("burstWindowMs").value || DEFAULTS.BURST_WINDOW_MS, 10)),
    IGNORE_SAME_ORIGIN_PWA: $("ignoreSameOriginPwa").checked,
    COOLDOWN_MS: Math.max(1000, parseInt($("cooldownMs").value || DEFAULTS.COOLDOWN_MS, 10))
  };
}

$("save").addEventListener("click", async () => {
  try {
    const payload = readForm();
    await chrome.runtime.sendMessage({ type: "save-config", payload });
    showSaved();
  } catch (e) {
    // invalid input already alerted
  }
});

$("reset").addEventListener("click", async () => {
  await chrome.storage.sync.set({ settings: DEFAULTS });
  applyToForm(DEFAULTS);
  showSaved();
});

loadSettings();
