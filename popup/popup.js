import { getSettings, hasLLMKey } from "../lib/settings.js";
import { canAccess } from "../lib/extract.js";
import { renderSummaryHTML, getCachedSummary } from "../lib/summary-view.js";
import { streamSummary, frameThrottle } from "../lib/summary-client.js";
import { getShortcuts, shortcutNodes, openShortcutsPage } from "../lib/shortcuts.js";

const $ = (id) => document.getElementById(id);
const btnOpen = $("btnOpenPanel");
let windowId = null;

function setStatus(text, kind = "") {
  const el = $("status");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "status " + kind;
  el.textContent = text;
}

function render(res) {
  $("result").innerHTML = renderSummaryHTML(res);
  $("result").classList.toggle("streaming", Boolean(res.streaming));
  $("result").hidden = false;
  setStatus("");
}
const renderPartial = frameThrottle((res) => {
  if (!done) render(res);
});
let done = false;

// Mở side panel: gọi sidePanel.open NGAY trong handler (không await trước đó)
// để giữ user gesture, rồi đóng popup.
btnOpen.addEventListener("click", () => {
  if (windowId == null) return;
  chrome.sidePanel.open({ windowId })
    .then(() => window.close())
    .catch((e) => setStatus(e?.message || String(e), "error"));
});

// Dòng phím tắt: cho biết Alt+S (mở popup này) có đang được gán không
getShortcuts().then((keys) => {
  const line = $("shortcutLine");
  const act = keys._execute_action, bili = keys["toggle-bilingual"];
  if (act) {
    line.append("Phím tắt: ", ...shortcutNodes(act), " mở popup này");
    if (bili) line.append(" · ", ...shortcutNodes(bili), " song ngữ");
  } else {
    line.classList.add("warn");
    line.append("Chưa gán phím tắt mở popup. ");
    const btn = Object.assign(document.createElement("button"), { type: "button", textContent: "Đặt phím tắt" });
    btn.addEventListener("click", () => openShortcutsPage().then(() => window.close()));
    line.append(btn);
  }
  line.hidden = false;
});

try {
  const settings = await getSettings();
  document.documentElement.dataset.theme = settings.theme === "pink" ? "pink" : "default";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    windowId = tab.windowId;
    btnOpen.disabled = false;
    $("pageTitle").textContent = tab.title || "—";
    let host = "";
    try { host = new URL(tab.url).hostname; } catch { /* ignore */ }
    $("pageHost").textContent = host;
  }

  if (!canAccess(tab)) {
    setStatus("Không thể đọc trang này (trang hệ thống của Chrome, Chrome Web Store hoặc file PDF).", "error");
  } else {
    const cached = await getCachedSummary(settings, tab.url);
    if (cached) {
      render(cached);
    } else if (!hasLLMKey(settings)) {
      setStatus("Chưa có API key. Bấm “Mở bảng đầy đủ” → tab Cài đặt để nhập key OpenRouter (miễn phí) hoặc OpenAI / Claude / Gemini.", "error");
    } else {
      // chạy ở background (đóng popup giữa chừng vẫn tóm tắt xong và lưu cache); chữ hiện dần khi AI đang viết
      setStatus("Đang đọc trang…", "loading");
      const { result } = await streamSummary({ tabId: tab.id, onPartial: renderPartial });
      done = true;
      render(result);
    }
  }
} catch (e) {
  setStatus(e?.message || String(e), "error");
}
