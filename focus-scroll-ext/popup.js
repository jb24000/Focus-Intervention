const $ = (id)=>document.getElementById(id);
const enabled = $("enabled");
const status = $("status");

function fmt(ts){
  const d = new Date(ts);
  return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

function setStatusText(cfg){
  if (!cfg.enabled) { status.textContent = "Status: disabled"; return; }
  if (cfg.pausedUntil && Date.now() < cfg.pausedUntil) {
    status.textContent = `Status: paused until ${fmt(cfg.pausedUntil)}`;
  } else {
    status.textContent = "Status: active";
  }
}

function endOfDayMs(){
  const d = new Date();
  d.setHours(23,59,59,999);
  return d.getTime();
}

function refresh(){
  chrome.runtime.sendMessage({ type: "get-config" }, (cfg) => {
    if (!cfg) return;
    enabled.checked = !!cfg.enabled;
    setStatusText(cfg);
  });
}

enabled.addEventListener("change", ()=>{
  chrome.runtime.sendMessage({ type: "set-enabled", enabled: enabled.checked }, ()=> refresh());
});

document.querySelectorAll(".pause").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const ms = Number(btn.getAttribute("data-ms") || 0);
    chrome.runtime.sendMessage({ type: "pause-for", ms }, ()=> refresh());
  });
});

$("pauseEod").addEventListener("click", ()=>{
  const until = endOfDayMs();
  const ms = Math.max(0, until - Date.now());
  chrome.runtime.sendMessage({ type: "pause-for", ms }, ()=> refresh());
});

$("resume").addEventListener("click", ()=>{
  chrome.runtime.sendMessage({ type: "resume-now" }, ()=> refresh());
});

$("options").addEventListener("click", ()=>{
  chrome.runtime.openOptionsPage();
});

refresh();
