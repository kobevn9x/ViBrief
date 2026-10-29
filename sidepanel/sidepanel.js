import { getSettings, saveSettings, hasLLMKey } from "../lib/settings.js";
import { callLLM, listOpenRouterFreeModels, resolveModel } from "../lib/llm.js";
import { canAccess, extractPage } from "../lib/extract.js";
import { chatWithPage, trimTurns, getCachedChat, setCachedChat, clearCachedChat } from "../lib/chat.js";
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
    updateChatCtxBar();
    return; // cùng trang – giữ nguyên kết quả / tiến trình
  }
  $("pageTitle").textContent = currentTab?.title || "—";
  let host = "";
  try { host = new URL(currentTab.url).hostname; } catch { /* ignore */ }
  $("pageHost").textContent = host;
  $("pageLabel").textContent = "Tóm tắt cho";

  // reset kết quả cũ khi đổi trang
  summarySeq++;
  lastSummary = null;
  resetChatForPage();
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
let lastSummary = null; // kết quả tóm tắt hoàn chỉnh cuối cùng của trang đang xem (làm ngữ cảnh cho Hỏi đáp)
function renderSummary(r) {
  shownFromSelection = Boolean(r.fromSelection);
  if (!r.streaming) lastSummary = r;
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

// ---------------------------------------------------------------- hỏi đáp
// Chat với AI về trang đang xem (gọi thẳng lib/ như nút "Kiểm tra kết nối", không qua background).
// Hội thoại + nội dung trang đã đọc lưu trong chrome.storage.session theo url – mở lại panel trên cùng trang thì còn nguyên.
const WEBMAIL = /(^|\.)(mail\.google\.com|gmail\.com|outlook\.(com|live\.com|office\.com|office365\.com)|mail\.yahoo\.com|zoho\.(com|mail)|proton\.(me|mail\.com)|webmail\.[a-z0-9.-]+)$/i;
let chatCtx = { url: null, host: "", page: null, turns: [] }; // ngữ cảnh + lịch sử của trang đang xem
let chatAbort = null; // AbortController của lượt đang trả lời (null = rảnh)

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Markdown nhẹ cho câu trả lời: escape trước rồi mới thêm thẻ (an toàn như renderSummaryHTML)
function renderChatHTML(text) {
  const inline = (s) => s.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = null;
  let listTag = "";
  let para = [];
  const closeList = () => { if (list) { out.push(`<${listTag}>${list.join("")}</${listTag}>`); list = null; } };
  const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  for (const raw of escapeHTML(String(text)).split(/\r?\n/)) {
    const line = raw.trim();
    let m = /^[-*•]\s+(.*)$/.exec(line);
    if (m) {
      closePara();
      if (listTag !== "ul") closeList();
      listTag = "ul";
      (list ||= []).push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    m = /^\d+[.)]\s+(.*)$/.exec(line);
    if (m) {
      closePara();
      if (listTag !== "ol") closeList();
      listTag = "ol";
      (list ||= []).push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    closeList();
    if (line) para.push(line);
    else closePara();
  }
  closePara();
  closeList();
  return out.join("") || "<p></p>";
}

function appendChatMsg(role, content) {
  const div = document.createElement("div");
  div.className = "chat-msg " + role;
  if (role === "user") div.textContent = content;
  else {
    const md = document.createElement("div");
    md.className = "md";
    md.innerHTML = renderChatHTML(content || "");
    div.dataset.plain = content || "";
    div.append(md);
  }
  $("chatLog").append(div);
  return div;
}

function chatMsgCopy(div) {
  const btn = document.createElement("button");
  btn.className = "msg-copy";
  btn.textContent = "Sao chép";
  btn.addEventListener("click", () => copy(div.dataset.plain || "", btn));
  div.append(btn);
}

// chỉ tự cuộn xuống khi người dùng đang ở gần cuối (không giành quyền cuộn khi đang đọc lại)
function chatScroll() {
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 90) window.scrollTo(0, document.body.scrollHeight);
}

function renderChatEmpty() {
  const box = document.createElement("div");
  box.className = "chat-empty";
  const p = document.createElement("p");
  p.textContent = "Hỏi thêm về trang này – ví dụ:";
  const chips = document.createElement("div");
  chips.className = "chips";
  // [nhãn, câu hỏi, soạn thêm?]: thẻ thường gửi ngay; thẻ "soạn thêm" chỉ điền vào ô nhập để người dùng thêm yêu cầu rồi tự bấm Gửi
  const ideas = [
    ["Tóm tắt ngắn gọn hơn", "Tóm tắt lại nội dung trang này ngắn gọn hơn."],
    ["Giải thích thêm chi tiết", "Giải thích thêm chi tiết về nội dung trang này."]
  ];
  if (chatCtx.host && WEBMAIL.test(chatCtx.host)) {
    ideas.unshift(["✉️ Viết email phản hồi", "Viết giúp tôi một email phản hồi email trong trang này. Phong cách: ", true]);
  }
  for (const [label, q, compose] of ideas) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (!compose) return sendChat(q); // gửi ngay; đang bận thì sendChat bỏ qua
      const input = $("chatInput");
      input.value = q;
      input.focus();
      input.setSelectionRange(q.length, q.length); // con trỏ ở cuối: gõ tiếp phong cách trả lời
      p.textContent = "Thêm phong cách trả lời (vd: lịch sự, ngắn gọn, thân mật, từ chối khéo…) rồi bấm Gửi.";
    });
    chips.append(b);
  }
  box.append(p, chips);
  $("chatLog").append(box);
}

function renderChatLog() {
  const log = $("chatLog");
  log.replaceChildren();
  if (!chatCtx.turns.length) {
    renderChatEmpty();
    return;
  }
  for (const t of chatCtx.turns) {
    const div = appendChatMsg(t.role, t.content);
    if (t.role === "assistant") chatMsgCopy(div);
  }
  window.scrollTo(0, document.body.scrollHeight);
}

function updateChatCtxBar() {
  const t = currentTab;
  $("chatCtxTitle").textContent = t?.title || t?.url || "—";
  const note = $("chatCtxNote");
  if (!t || !canAccess(t)) note.textContent = "không đọc được nội dung trang này";
  else if (chatCtx.page) note.textContent = "đã đọc nội dung trang";
  else note.textContent = "sẽ đọc trang khi bạn hỏi";
}

// đổi trang: huỷ lượt đang gửi, nạp hội thoại đã lưu của url mới (nếu có)
async function resetChatForPage() {
  chatAbort?.abort();
  chatAbort = null;
  setChatBusy(false);
  const t = currentTab;
  const url = t?.url || null;
  let host = "";
  try { host = new URL(url).hostname; } catch { /* ignore */ }
  const next = { url, host, page: null, turns: [] };
  const cached = url ? await getCachedChat(url) : null;
  if (cached && Array.isArray(cached.turns)) {
    next.page = cached.page || null;
    next.turns = cached.turns;
  }
  if (url !== currentTab?.url) return; // đã đổi tab tiếp trong lúc đọc cache
  chatCtx = next;
  renderChatLog();
  updateChatCtxBar();
}

async function saveChatSession(ctx = chatCtx) {
  if (!ctx.url) return;
  if (!ctx.turns.length) await clearCachedChat(ctx.url);
  else await setCachedChat(ctx.url, { url: ctx.url, title: currentTab?.title, page: ctx.page, turns: ctx.turns });
}

// đọc nội dung trang một lần cho tới khi đổi trang / bấm đọc lại
const MIN_PAGE_CHARS = 50; // ít hơn mức này coi như không đọc được (vd. trang chưa dựng xong)

/**
 * @returns {Promise<boolean>} false nếu trang đọc được mà việc đọc thất bại (lỗi hoặc gần như không có chữ);
 *   trang hệ thống (không đọc được) vẫn trả true: khi đó chat như trợ lý chung.
 */
async function ensureChatPage(ctx = chatCtx) {
  const tab = currentTab;
  if (ctx.page || !canAccess(tab)) return true;
  setStatus($("chatStatus"), "Đang đọc trang…", "loading");
  let page = null;
  try {
    page = await extractPage(tab.id);
  } catch { /* báo lỗi bên dưới */ }
  if (ctx !== chatCtx) return true; // đã đổi trang: bỏ kết quả, không ghi nhầm vào hội thoại mới
  const ok = Boolean(page?.text && page.text.trim().length >= MIN_PAGE_CHARS);
  ctx.page = ok ? page : null;
  if (ok) setStatus($("chatStatus"), "");
  else setStatus($("chatStatus"), "Không đọc được nội dung trang – bấm ⟳ để thử lại.", "error");
  updateChatCtxBar();
  return ok;
}

function setChatBusy(busy) {
  const btn = $("btnChatSend");
  btn.textContent = busy ? "Dừng" : "Gửi";
  btn.classList.toggle("stop", busy);
}

// `override`: câu hỏi có sẵn (bấm thẻ gợi ý) → gửi ngay, không đụng tới nội dung đang gõ trong ô nhập
async function sendChat(override) {
  const input = $("chatInput");
  const fromChip = typeof override === "string";
  const text = (fromChip ? override : input.value).trim();
  if (!text || chatAbort) return;
  if (!hasLLMKey(settings)) {
    setStatus($("chatStatus"), "Chưa có API key. Vào tab Cài đặt để nhập key OpenRouter (miễn phí) hoặc OpenAI / Claude / Gemini.", "error");
    return;
  }
  const ctx = chatCtx; // giữ ctx này kể cả khi người dùng đổi tab giữa chừng
  const brief = lastSummary; // bản tóm tắt người dùng vừa đọc trên trang này
  // khoá ngay từ đầu (trước lúc đọc trang) để gửi lần hai / bấm đúp thẻ không chạy song song; nút hiện "Dừng"
  const abort = new AbortController();
  chatAbort = abort;
  setChatBusy(true);
  const release = () => {
    if (chatAbort === abort) {
      chatAbort = null;
      setChatBusy(false);
    }
  };

  const pageOk = await ensureChatPage(ctx);
  if (abort.signal.aborted || ctx !== chatCtx || !pageOk) {
    release(); // bấm Dừng / đổi trang / đọc trang lỗi (đã báo lỗi): không gửi, câu đang gõ vẫn còn
    return;
  }

  setStatus($("chatStatus"), "");
  if (!fromChip) input.value = "";
  $("chatLog").querySelector(".chat-empty")?.remove();
  appendChatMsg("user", text);
  chatScroll();

  const turns = [...ctx.turns, { role: "user", content: text }];
  const bubble = appendChatMsg("assistant", "");
  bubble.classList.add("streaming");
  const md = bubble.querySelector(".md");

  let acc = "";
  // chữ hiện dần: gộp vẽ trong cùng một khung hình (onDelta đưa từng đoạn chữ, phải cộng dồn trước)
  const paint = frameThrottle((full) => {
    if (ctx !== chatCtx) return;
    md.innerHTML = renderChatHTML(full);
    bubble.dataset.plain = full;
    chatScroll();
  });
  try {
    const reply = await chatWithPage(settings, {
      page: ctx.page,
      brief,
      turns,
      onDelta: (d) => {
        acc += d;
        paint(acc);
      },
      signal: abort.signal
    });
    ctx.turns = trimTurns([...turns, { role: "assistant", content: reply }]);
    if (ctx === chatCtx) {
      md.innerHTML = renderChatHTML(reply);
      bubble.dataset.plain = reply;
      chatMsgCopy(bubble);
      chatScroll();
    }
    await saveChatSession(ctx); // đổi tab giữa chừng: vẫn lưu vào hội thoại của trang cũ
  } catch (e) {
    if (e.name === "AbortError") {
      // bấm "Dừng" / đổi trang: giữ câu hỏi + phần đã viết (nếu có) trong hội thoại
      ctx.turns = trimTurns(acc.trim() ? [...turns, { role: "assistant", content: acc }] : turns);
      if (acc.trim()) {
        md.innerHTML = renderChatHTML(acc);
        bubble.dataset.plain = acc;
        if (ctx === chatCtx) chatMsgCopy(bubble);
      } else if (ctx === chatCtx) {
        bubble.remove();
      }
      await saveChatSession(ctx);
    } else if (ctx === chatCtx) {
      bubble.remove();
      [...$("chatLog").querySelectorAll(".chat-msg.user")].at(-1)?.remove(); // câu hỏi không vào lịch sử
      if (!fromChip || !input.value.trim()) input.value = text; // trả về ô nhập để sửa rồi gửi lại (không đè nội dung đang gõ)
      setStatus($("chatStatus"), e.message || String(e), "error");
    }
  } finally {
    bubble.classList.remove("streaming");
    release();
  }
}

$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!chatAbort) sendChat();
  }
});
$("btnChatSend").addEventListener("click", () => (chatAbort ? chatAbort.abort() : sendChat()));
$("btnChatRefresh").addEventListener("click", async () => {
  if (!canAccess(currentTab)) {
    setStatus($("chatStatus"), "Không đọc được nội dung trang này (trang hệ thống của Chrome, Chrome Web Store hoặc file PDF).", "error");
    return;
  }
  chatCtx.page = null;
  await ensureChatPage();
});
$("btnChatClear").addEventListener("click", async () => {
  chatAbort?.abort();
  chatCtx.turns = [];
  if (chatCtx.url) await clearCachedChat(chatCtx.url);
  renderChatLog(); // giữ nguyên nội dung trang đã đọc
});
$("btnAskMore").addEventListener("click", () => {
  showTab("chat");
  $("chatInput").focus();
});

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
  else if (info.title) {
    $("pageTitle").textContent = info.title;
    updateChatCtxBar();
  }
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
