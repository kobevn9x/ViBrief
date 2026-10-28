import { getSettings, saveSettings, hasLLMKey } from "../lib/settings.js";
import { callLLM, listOpenRouterFreeModels, resolveModel } from "../lib/llm.js";
import { canAccess } from "../lib/extract.js";
import { renderSummaryHTML, summaryToPlainText, getCachedSummary } from "../lib/summary-view.js";
import { streamSummary, frameThrottle } from "../lib/summary-client.js";
import { targetFor } from "../lib/translate.js";
import { SHORTCUT_LABELS, getShortcuts, shortcutNodes, openShortcutsPage } from "../lib/shortcuts.js";

const $ = (id) => document.getElementById(id);
let settings = await getSettings();
applyTheme();
let currentTab = null;
let summarySeq = 0; // tăng mỗi lần đổi trang / tóm tắt lại → bỏ qua kết quả cũ về muộn

// ---------------------------------------------------------------- tabs UI
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  if (name === "translate") refreshBilingualState();
}

// ---------------------------------------------------------------- helpers
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === "pink" ? "pink" : "default";
}

function setStatus(el, text, kind = "") {
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "status " + kind;
  el.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// ---------------------------------------------------------------- page card
async function refreshPage() {
  const prev = currentTab;
  currentTab = await getActiveTab();
  if (prev && currentTab && prev.id === currentTab.id && prev.url === currentTab.url) {
    $("pageTitle").textContent = currentTab.title || "—";
    return; // cùng trang – giữ nguyên kết quả / tiến trình
  }
  $("pageTitle").textContent = currentTab?.title || "—";
  let host = "";
  try { host = new URL(currentTab.url).hostname; } catch { /* ignore */ }
  $("pageHost").textContent = host;
  $("pageLabel").textContent = "Tóm tắt cho";

  // reset kết quả cũ khi đổi trang
  summarySeq++;
  $("btnSummarize").disabled = false;
  $("summaryResult").hidden = true;
  setStatus($("summaryStatus"), "");

  if (!canAccess(currentTab)) {
    setStatus($("summaryStatus"), "Không thể đọc trang này (trang hệ thống của Chrome, Chrome Web Store hoặc file PDF).", "error");
    $("btnSummarize").disabled = true;
    return;
  }
  $("btnSummarize").disabled = false;

  const cached = await getCachedSummary(settings, currentTab.url);
  if (cached) renderSummary(cached);
  else if (settings.autoSummarize && hasLLMKey(settings)) runSummary();

  if (!$("tab-translate").hidden) refreshBilingualState();
}

// ---------------------------------------------------------------- summary
// Việc tóm tắt chạy ở background (dùng chung cache + yêu cầu đang chạy với popup và nút nổi)
// scope "auto": đoạn đang bôi đen (đủ dài) nếu có, không thì cả trang; "selection": bắt buộc đoạn chọn
async function runSummary(force = false, scope = "auto") {
  if (!currentTab) return;
  if (!hasLLMKey(settings)) {
    setStatus($("summaryStatus"), "Chưa có API key. Vào tab Cài đặt để nhập key OpenRouter (miễn phí) hoặc OpenAI / Claude / Gemini.", "error");
    return;
  }
  const seq = ++summarySeq;
  const tab = currentTab;

  $("btnSummarize").disabled = true;
  $("summaryResult").hidden = true;
  setStatus($("summaryStatus"), "Đang đọc trang…", "loading");
  const stale = () => seq !== summarySeq || tab.id !== currentTab?.id;
  // chữ hiện dần trong lúc AI đang viết
  const onPartial = frameThrottle((r) => {
    if (stale() || seqDone === seq || !r) return;
    setStatus($("summaryStatus"), "");
    renderSummary(r);
  });
  let res;
  try {
    res = await streamSummary({ tabId: tab.id, force, scope, onPartial });
  } catch (e) {
    if (stale()) return;
    $("btnSummarize").disabled = false;
    $("summaryResult").hidden = true;
    setStatus($("summaryStatus"), e.message || String(e), "error");
    return;
  }
  if (stale()) return;
  seqDone = seq;
  $("btnSummarize").disabled = false;
  renderSummary(res.result);
  setStatus($("summaryStatus"), "");
}
let seqDone = 0; // lượt đã xong: bỏ qua bản dở dang vẽ muộn sau kết quả cuối

// Dòng số đo của lần tóm tắt: tổng thời gian, đọc trang, AI, token, model
function formatStats(st) {
  if (!st?.totalMs) return "";
  const sec = (ms) => (ms / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " s";
  const parts = [`⏱ ${sec(st.totalMs)}`];
  if (st.ttfbMs !== undefined) parts.push(`chữ đầu ${sec(st.ttfbMs)}`);
  parts.push(`đọc trang ${st.extractMs} ms (${st.method})`, `AI ${sec(st.llmMs)}`);
  if (st.relangBy !== undefined) parts.push(`AI sai ngôn ngữ → dịch lại (${st.relangBy || "lỗi"})`);
  if (st.translatedBy !== undefined) parts.push(`dịch EN ${sec(st.translateMs)} (${st.translatedBy || "lỗi"})`);
  if (st.inTok || st.outTok) parts.push(`${st.inTok ?? "?"} → ${st.outTok ?? "?"} token`);
  if (st.model) parts.push(st.model);
  return parts.join(" · ");
}

let shownFromSelection = false;
function renderSummary(r) {
  shownFromSelection = Boolean(r.fromSelection);
  $("pageLabel").textContent = r.fromSelection ? "Tóm tắt đoạn đã chọn trên" : "Tóm tắt cho";
  $("resBody").innerHTML = renderSummaryHTML(r); // lib đã escape HTML trước khi chèn <mark>
  $("resBody").classList.toggle("streaming", Boolean(r.streaming));
  const stats = formatStats(r.stats);
  $("resStats").textContent = stats;
  $("resStats").hidden = !stats;
  $("summaryResult").hidden = false;
  $("summaryResult").dataset.plain = summaryToPlainText(r, currentTab?.url || "");
}

$("btnSummarize").addEventListener("click", () => runSummary());
// "Tóm tắt lại" chỉ làm lại bản đang hiện: bản cả trang thì bỏ qua đoạn đang bôi đen
$("btnResummarize").addEventListener("click", () => runSummary(true, shownFromSelection ? "selection" : "page"));
$("btnCopySummary").addEventListener("click", (e) => copy($("summaryResult").dataset.plain, e.target));

for (const id of ["summaryLang", "summaryLength"]) {
  $(id).value = settings[id];
  $(id).addEventListener("change", async () => {
    settings = await saveSettings({ [id]: $(id).value });
    const cached = currentTab && (await getCachedSummary(settings, currentTab.url));
    if (cached) renderSummary(cached);
    else $("summaryResult").hidden = true;
  });
}

async function copy(text, btn) {
  await navigator.clipboard.writeText(text || "");
  const old = btn.textContent;
  btn.textContent = "Đã chép ✓";
  setTimeout(() => (btn.textContent = old), 1200);
}

// ---------------------------------------------------------------- bilingual
function renderBilingual(active, msg) {
  $("btnBilingual").setAttribute("aria-checked", String(Boolean(active)));
  $("biliState").textContent = msg || (active ? "Đang bật – bản dịch hiện dưới mỗi đoạn" : "Đang tắt");
}

async function refreshBilingualState() {
  if (!canAccess(currentTab)) {
    $("btnBilingual").disabled = true;
    renderBilingual(false, "Không dùng được trên trang này");
    return;
  }
  $("btnBilingual").disabled = false;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => Boolean(window.__tldrvi?.active)
    });
    renderBilingual(result);
  } catch {
    renderBilingual(false);
  }
}

async function setBilingual(force) {
  if (!currentTab) return;
  $("btnBilingual").disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "toggle-bilingual", tabId: currentTab.id, force });
  $("btnBilingual").disabled = false;
  if (res?.ok) renderBilingual(res.active);
  else renderBilingual(false, "Lỗi: " + (res?.error || "không rõ"));
}

$("btnBilingual").addEventListener("click", () => {
  const on = $("btnBilingual").getAttribute("aria-checked") === "true";
  setBilingual(!on);
});

for (const id of ["translateDirection", "translateEngine"]) {
  $(id).value = settings[id];
  $(id).addEventListener("change", async () => {
    settings = await saveSettings({ [id]: $(id).value });
    if (id === "translateEngine" && settings.translateEngine === "llm" && !hasLLMKey(settings)) {
      $("biliState").textContent = "Cần nhập API key ở tab Cài đặt để dịch bằng AI";
    }
    // đang bật thì áp dụng lại với cài đặt mới
    if ($("btnBilingual").getAttribute("aria-checked") === "true") {
      await setBilingual(false);
      await setBilingual(true);
    }
  });
}

// dịch nhanh
function updateQtDir() {
  const t = $("qtInput").value.trim();
  $("qtDir").textContent = t ? (targetFor(t, settings.translateDirection) === "vi" ? "→ Tiếng Việt" : "→ English") : "";
}
$("qtInput").addEventListener("input", updateQtDir);
$("qtInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("btnQuickTranslate").click();
});
$("btnQuickTranslate").addEventListener("click", async () => {
  const text = $("qtInput").value.trim();
  if (!text) return;
  const target = targetFor(text, settings.translateDirection);
  $("btnQuickTranslate").disabled = true;
  $("qtOutput").hidden = false;
  $("qtOutput").textContent = "Đang dịch…";
  // giữ xuống dòng: dịch từng đoạn
  const paras = text.split(/\n{2,}/);
  const res = await chrome.runtime.sendMessage({ type: "translate", target, texts: paras });
  $("btnQuickTranslate").disabled = false;
  if (res?.ok) {
    $("qtOutput").textContent = res.translations.map((t, i) => t ?? paras[i]).join("\n\n");
    $("btnCopyQt").hidden = false;
  } else {
    $("qtOutput").textContent = "Không dịch được: " + (res?.error || "lỗi không rõ");
  }
});
$("btnCopyQt").addEventListener("click", (e) => copy($("qtOutput").textContent, e.target));

// ---------------------------------------------------------------- settings
const draft = { apiKeys: { ...settings.apiKeys }, models: { ...settings.models } };

function loadProviderFields() {
  const p = $("provider").value;
  $("apiKey").value = draft.apiKeys[p] || "";
  $("apiKey").placeholder =
    p === "compat" ? "Không bắt buộc với Ollama/LM Studio"
    : p === "openrouter" ? "Dán API key OpenRouter (miễn phí tại openrouter.ai/keys)"
    : "Dán API key…";
  $("model").value = draft.models[p] || "";
  $("model").placeholder = p === "openrouter" ? "Để trống = tự chọn model miễn phí" : "";
  $("baseUrlField").hidden = p !== "compat";
  $("btnFreeModels").hidden = p !== "openrouter";
}
function stashProviderFields(p) {
  draft.apiKeys[p] = $("apiKey").value.trim();
  draft.models[p] = $("model").value.trim();
}

$("provider").value = settings.provider;
$("compatBaseUrl").value = settings.compatBaseUrl;
$("autoSummarize").checked = settings.autoSummarize;
$("theme").value = settings.theme === "pink" ? "pink" : "default";
$("showFab").checked = settings.showFab !== false;
loadProviderFields();

// giao diện + nút nổi: lưu ngay khi đổi (nút Lưu không ghi đè các trường này)
$("theme").addEventListener("change", async () => {
  settings = await saveSettings({ theme: $("theme").value });
  applyTheme();
});
$("showFab").addEventListener("change", async () => {
  settings = await saveSettings({ showFab: $("showFab").checked });
});

let lastProvider = settings.provider;
$("provider").addEventListener("change", () => {
  stashProviderFields(lastProvider);
  lastProvider = $("provider").value;
  loadProviderFields();
});

$("btnFreeModels").addEventListener("click", async () => {
  const btn = $("btnFreeModels");
  btn.disabled = true;
  setStatus($("settingsStatus"), "Đang tải danh sách model miễn phí…", "loading");
  try {
    const ids = await listOpenRouterFreeModels();
    const list = $("modelList");
    list.replaceChildren(...ids.map((id) => Object.assign(document.createElement("option"), { value: id })));
    setStatus($("settingsStatus"), `Đã tải ${ids.length} model miễn phí – chọn trong ô Model.`);
  } catch (e) {
    setStatus($("settingsStatus"), e.message || String(e), "error");
  } finally {
    btn.disabled = false;
  }
});

async function persistSettings() {
  const p = $("provider").value;
  stashProviderFields(p);
  settings = await saveSettings({
    provider: p,
    apiKeys: draft.apiKeys,
    models: draft.models,
    compatBaseUrl: $("compatBaseUrl").value.trim(),
    autoSummarize: $("autoSummarize").checked
  });
}

$("btnSave").addEventListener("click", async () => {
  await persistSettings();
  setStatus($("settingsStatus"), "Đã lưu cài đặt.");
  setTimeout(() => setStatus($("settingsStatus"), ""), 1800);
});

$("btnTest").addEventListener("click", async () => {
  await persistSettings();
  setStatus($("settingsStatus"), "Đang kiểm tra…", "loading");
  try {
    const out = await callLLM(settings, { system: "You are a connectivity check.", user: "Reply with exactly: OK", maxTokens: 20 });
    const model = await resolveModel(settings);
    setStatus($("settingsStatus"), `Kết nối thành công ✓ (${model} trả lời: “${out.trim().slice(0, 40)}”)`);
  } catch (e) {
    setStatus($("settingsStatus"), e.message, "error");
  }
});

$("appVersion").textContent = chrome.runtime.getManifest().version;

// phím tắt đang gán thật (Chrome không gán nếu trùng extension khác; người dùng có thể đổi/xoá)
async function renderShortcuts() {
  const keys = await getShortcuts();
  $("shortcutList").replaceChildren(...Object.entries(SHORTCUT_LABELS).map(([name, label]) => {
    const li = document.createElement("li");
    const key = document.createElement("span");
    if (keys[name]) key.append(...shortcutNodes(keys[name]));
    else Object.assign(key, { className: "unset", textContent: "Chưa gán" });
    li.append(Object.assign(document.createElement("span"), { textContent: label }), key);
    return li;
  }));
  const bili = keys["toggle-bilingual"];
  $("hintBilingual").replaceChildren(...(bili ? shortcutNodes(bili) : [document.createTextNode("(chưa gán phím)")]));
}
renderShortcuts();
window.addEventListener("focus", renderShortcuts); // quay lại sau khi đổi ở chrome://extensions/shortcuts
$("btnShortcuts").addEventListener("click", () => openShortcutsPage());

// ---------------------------------------------------------------- tab events
chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  const win = await chrome.windows.getCurrent();
  if (windowId === win.id) refreshPage();
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== currentTab?.id) return;
  if (info.status === "complete" || info.url) refreshPage();
  else if (info.title) $("pageTitle").textContent = info.title;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "summarize-now") {
    showTab("summary");
    chrome.storage.session.remove("pendingSummarize");
    refreshPage().then(() => runSummary(false, msg.selection ? "selection" : "auto"));
  }
});

await refreshPage();
const { pendingSummarize } = await chrome.storage.session.get("pendingSummarize");
if (pendingSummarize) {
  await chrome.storage.session.remove("pendingSummarize");
  // từ menu "Tóm tắt đoạn đã chọn": luôn chạy (kể cả khi đang hiện bản cả trang từ cache)
  if (pendingSummarize.tabId === currentTab?.id && (pendingSummarize.selection || $("summaryResult").hidden)) {
    runSummary(false, pendingSummarize.selection ? "selection" : "auto");
  }
}
