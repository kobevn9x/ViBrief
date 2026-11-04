import { getSettings, saveSettings, hasLLMKey } from "../lib/settings.js";
import { callLLM, listOpenRouterFreeModels, resolveModel } from "../lib/llm.js";
import { canAccess, extractPage, getSelectionText } from "../lib/extract.js";
import { chatWithPage, getCachedChat, setCachedChat, clearCachedChat, looksLikeMail, REPLY_PROMPT, REPLY_STYLES } from "../lib/chat.js";
import { createChatSession } from "../lib/chat-session.js";
import { renderSummaryHTML, summaryToPlainText, getCachedSummary } from "../lib/summary-view.js";
import { streamSummary, frameThrottle } from "../lib/summary-client.js";
import { targetFor } from "../lib/translate.js";
import { SHORTCUT_LABELS, getShortcuts, shortcutNodes, openShortcutsPage } from "../lib/shortcuts.js";
import { LIMITS, MAX_EXAMPLES, effortOf, addExample } from "../lib/personal.js";

const $ = (id) => document.getElementById(id);
let settings = await getSettings();
applyTheme();
let currentTab = null;
// Chức năng (Tóm tắt / Dịch / Hỏi đáp) đang dùng ở từng tab trình duyệt: panel dùng chung cả cửa sổ nên phải tự nhớ
// theo tab, lưu session để đóng/mở lại panel vẫn còn; Cài đặt không được nhớ (chỉ là nơi ghé qua).
let fnByTab = (await chrome.storage.session.get("panelFn")).panelFn || {};
const saveFnByTab = () => chrome.storage.session.set({ panelFn: fnByTab }).catch(() => {});
let summarySeq = 0; // tăng mỗi lần đổi trang / tóm tắt lại → bỏ qua kết quả cũ về muộn

// ---------------------------------------------------------------- tabs UI + Liquid Glass Gliding
const tabsNav = document.querySelector(".tabs");
const tabIndicator = document.querySelector(".tab-indicator");

function moveIndicator(btn) {
  if (!btn || !tabIndicator || !tabsNav) return;
  const navRect = tabsNav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const left = btnRect.left - navRect.left;
  const width = btnRect.width;

  tabIndicator.style.transform = `translateX(${Math.round(left)}px)`;
  tabIndicator.style.width = `${Math.round(width)}px`;
  tabIndicator.style.opacity = "1";
}

function updateActiveIndicator() {
  const activeBtn = document.querySelector('.tabs button[aria-selected="true"]');
  if (activeBtn) moveIndicator(activeBtn);
}

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    showTab(btn.dataset.tab);
    moveIndicator(btn);
  });
  btn.addEventListener("mouseenter", () => {
    moveIndicator(btn);
  });
});

tabsNav?.addEventListener("mouseleave", () => {
  updateActiveIndicator();
});

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  updateActiveIndicator();
  if (name !== "settings" && currentTab && fnByTab[currentTab.id] !== name) {
    fnByTab[currentTab.id] = name;
    saveFnByTab();
  }
  if (name === "translate") refreshBilingualState();
}

requestAnimationFrame(() => updateActiveIndicator());
// đổi cỡ panel: nhảy thẳng tới vị trí mới (trượt từ chỗ cũ sẽ làm trang tràn ngang trong lúc chạy)
window.addEventListener("resize", () => {
  if (!tabIndicator) return;
  tabIndicator.style.transition = "none";
  updateActiveIndicator();
  void tabIndicator.offsetWidth;
  tabIndicator.style.transition = "";
});

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
    chat.setPage(currentTab); // cùng url: chỉ cập nhật tiêu đề/tab của hội thoại
    updateChatCtxBar();
    return; // cùng trang – giữ nguyên kết quả / tiến trình
  }
  $("pageTitle").textContent = currentTab?.title || "—";
  // đổi sang tab khác: về chức năng tab đó đang dùng (chưa dùng → Tóm tắt); đang ở Cài đặt thì giữ nguyên
  if (currentTab && prev?.id !== currentTab.id && $("tab-settings").hidden) showTab(fnByTab[currentTab.id] || "summary");
  let host = "";
  try { host = new URL(currentTab.url).hostname; } catch { /* ignore */ }
  $("pageHost").textContent = host;
  $("pageLabel").textContent = "Tóm tắt cho";

  // reset kết quả cũ khi đổi trang
  summarySeq++;
  lastSummary = null;
  chat.setPage(currentTab); // đổi hội thoại ngay trong cùng nhịp với currentTab (storage nạp ở nền)
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
// Máy trạng thái (hội thoại theo url, lượt chạy nền, đọc trang, đoạn bôi đen, lưu session) nằm ở lib/chat-session.js;
// phần dưới chỉ vẽ theo sự kiện của nó. Sang tab khác KHÔNG dừng lượt đang trả lời: nó chạy tiếp và tự lưu vào trang cũ.
const chat = createChatSession({
  chatWithPage, extractPage, getSelectionText, canAccess,
  store: { get: getCachedChat, set: setCachedChat, clear: clearCachedChat },
  getSettings: () => settings,
  saveSettings: async (patch) => { settings = await saveSettings(patch); },
  hasKey: () => hasLLMKey(settings)
});

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
  // lưu câu trả lời ưng ý làm mẫu văn phong cho lần viết email sau (Cài đặt → Cá nhân hoá AI)
  const save = document.createElement("button");
  save.className = "msg-save";
  save.textContent = "Lưu làm mẫu";
  save.title = "Lưu câu trả lời này làm mẫu văn phong cho các email sau";
  save.addEventListener("click", async () => {
    settings = await saveSettings({ emailExamples: addExample(settings.emailExamples, div.dataset.plain || "") });
    renderExamples();
    save.textContent = "Đã lưu mẫu ✓";
  });
  div.append(btn, save);
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
  // [nhãn, câu hỏi]: thẻ thường gửi ngay
  const ideas = [
    ["Tóm tắt ngắn gọn hơn", "Tóm tắt lại nội dung trang này ngắn gọn hơn."],
    ["Giải thích thêm chi tiết", "Giải thích thêm chi tiết về nội dung trang này."]
  ].map(([label, q]) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", () => sendChat(q)); // gửi ngay; đang bận thì sendChat bỏ qua
    return b;
  });

  // thẻ "Viết phản hồi" luôn hiện (email, ticket Freshdesk, tin nhắn…); chỉ điền sẵn ô nhập để người dùng thêm
  // phong cách trả lời rồi tự bấm Gửi. Trang giống thư/helpdesk (looksLikeMail) thì xếp đầu hàng, còn lại xếp cuối.
  let presets = null;
  const reply = document.createElement("button");
  reply.className = "chip";
  reply.textContent = "✉️ Viết phản hồi";
  reply.title = "Soạn thư/ticket/tin nhắn phản hồi – bôi đen tin cần trả lời để chọn đúng tin";
  reply.addEventListener("click", () => {
    const input = $("chatInput");
    const q = REPLY_PROMPT + (settings.replyStyle || ""); // nhớ phong cách lần trước
    input.value = q;
    input.focus();
    input.setSelectionRange(q.length, q.length); // con trỏ ở cuối: gõ tiếp phong cách trả lời
    p.textContent = "Bôi đen tin cần trả lời (nếu cần), thêm phong cách rồi bấm Gửi:";
    if (presets) return;
    presets = document.createElement("div");
    presets.className = "chips presets";
    for (const [label, text] of REPLY_STYLES) {
      const s = document.createElement("button");
      s.className = "chip";
      s.textContent = label;
      s.addEventListener("click", () => {
        let v = input.value.startsWith(REPLY_PROMPT) ? input.value : REPLY_PROMPT; // chưa bấm thẻ ✉️ / đã sửa câu → bắt đầu lại
        if (!v.includes(text)) v = v.trimEnd().endsWith(":") ? v.trimEnd() + " " + text : v.replace(/[\s,]+$/, "") + ", " + text;
        input.value = v;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      presets.append(s);
    }
    box.append(presets);
  });
  if (looksLikeMail(currentTab)) ideas.unshift(reply);
  else ideas.push(reply);

  chips.append(...ideas);
  box.append(p, chips);
  $("chatLog").append(box);
}

function renderChatLog() {
  const ctx = chat.ctx;
  const log = $("chatLog");
  log.replaceChildren();
  if (!ctx.turns.length && !ctx.job) {
    renderChatEmpty();
    return;
  }
  for (const t of ctx.turns) {
    const div = appendChatMsg(t.role, t.content);
    if (t.role === "assistant") chatMsgCopy(div);
  }
  if (ctx.job) attachJobView(ctx.job); // lượt đang chạy (vd. vừa quay lại tab này)
  window.scrollTo(0, document.body.scrollHeight);
}

// bong bóng của từng lượt đang chạy (job → {user, bubble, md, paint}); lib/chat-session.js không biết DOM
const jobViews = new WeakMap();

/** Vẽ câu hỏi đang chờ + bong bóng trả lời đang về của một lượt; chữ về sau sẽ vẽ vào đây. */
function attachJobView(job) {
  if (!job.question) return; // còn đang đọc trang: chưa có gì để vẽ
  $("chatLog").querySelector(".chat-empty")?.remove();
  const user = appendChatMsg("user", job.question);
  const bubble = appendChatMsg("assistant", "");
  bubble.classList.add("streaming");
  const md = bubble.querySelector(".md");
  if (job.acc) {
    md.innerHTML = renderChatHTML(job.acc);
    bubble.dataset.plain = job.acc;
  }
  // chữ hiện dần: gộp vẽ trong cùng một khung hình (job.acc là bản cộng dồn)
  const paint = frameThrottle(() => {
    if (jobViews.get(job)?.bubble !== bubble) return; // đã vẽ lại hội thoại / có bong bóng mới
    md.innerHTML = renderChatHTML(job.acc);
    bubble.dataset.plain = job.acc;
    chatScroll();
  });
  jobViews.set(job, { user, bubble, md, paint });
  chatScroll();
}

/** Bong bóng đang hiện (nếu đang xem hội thoại này) → câu trả lời cuối cùng; rỗng thì bỏ bong bóng. */
function finishView(job, content) {
  const v = jobViews.get(job);
  if (!v) return;
  v.bubble.classList.remove("streaming");
  if (!content) {
    v.bubble.remove();
    return;
  }
  v.md.innerHTML = renderChatHTML(content);
  v.bubble.dataset.plain = content;
  chatMsgCopy(v.bubble);
  chatScroll();
}

function updateChatCtxBar() {
  const t = currentTab;
  const ctx = chat.ctx;
  $("chatCtxTitle").textContent = t?.title || t?.url || "—";
  const note = $("chatCtxNote");
  if (!t || !canAccess(t)) note.textContent = "không đọc được nội dung trang này";
  else if (ctx.page) note.textContent = "đã đọc nội dung trang";
  else note.textContent = "sẽ đọc trang khi bạn hỏi";
  if (t && canAccess(t) && ctx.selection) note.textContent += ` · kèm đoạn bôi đen (${ctx.selection.length.toLocaleString("vi-VN")} ký tự)`;
}

function setChatBusy(busy) {
  const btn = $("btnChatSend");
  btn.textContent = busy ? "Dừng" : "Gửi";
  btn.classList.toggle("stop", busy);
}

// `override`: câu hỏi có sẵn (bấm thẻ gợi ý) → gửi ngay, không đụng tới nội dung đang gõ trong ô nhập.
// Mọi luật (khoá, đọc trang, đoạn bôi đen, lưu theo trang lúc bấm gửi) nằm trong lib/chat-session.js; panel chỉ vẽ theo sự kiện.
function sendChat(override) {
  const fromChip = typeof override === "string";
  return chat.send({ text: fromChip ? override : $("chatInput").value, fromChip, brief: lastSummary });
}

const CHAT_ERRORS = {
  "no-key": "Chưa có API key. Vào tab Cài đặt để nhập key OpenRouter (miễn phí) hoặc OpenAI / Claude / Gemini.",
  "no-access": "Không đọc được nội dung trang này (trang hệ thống của Chrome, Chrome Web Store hoặc file PDF).",
  "page-read": "Không đọc được nội dung trang – bấm ⟳ để thử lại."
};

const here = (ctx) => ctx === chat.ctx; // sự kiện của hội thoại ở tab khác không vẽ lên màn hình
chat.on("state", ({ ctx, relog }) => {
  if (!here(ctx)) return;
  setChatBusy(chat.isBusy());
  if (relog) {
    setStatus($("chatStatus"), "");
    renderChatLog();
  }
  updateChatCtxBar();
});
chat.on("status", ({ ctx, code }) => {
  if (here(ctx)) setStatus($("chatStatus"), code === "reading" ? "Đang đọc trang…" : "", code ? "loading" : "");
});
chat.on("started", ({ ctx, job, text, fromChip }) => {
  if (!here(ctx)) return;
  setStatus($("chatStatus"), "");
  if (!fromChip && $("chatInput").value.trim() === text) $("chatInput").value = "";
  attachJobView(job);
});
chat.on("delta", ({ ctx, job }) => {
  if (here(ctx)) jobViews.get(job)?.paint();
});
chat.on("done", ({ ctx, job, reply }) => {
  if (here(ctx)) finishView(job, reply);
});
chat.on("aborted", ({ ctx, job, partial }) => {
  if (here(ctx)) finishView(job, partial);
});
chat.on("failed", ({ ctx, job, code, message, text, restore }) => {
  if (!here(ctx)) return;
  const v = job && jobViews.get(job);
  if (v) { // câu hỏi không vào lịch sử
    v.bubble.remove();
    v.user.remove();
  }
  setStatus($("chatStatus"), code === "error" ? message : CHAT_ERRORS[code], "error");
  const input = $("chatInput");
  if (restore === "always" || (restore === "ifEmpty" && !input.value.trim())) input.value = text; // trả về ô nhập để sửa rồi gửi lại
});

$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!chat.isBusy()) sendChat();
  }
});
$("btnChatSend").addEventListener("click", () => (chat.isBusy() ? chat.stop() : sendChat()));
$("btnChatRefresh").addEventListener("click", () => chat.refreshPage());
$("btnChatClear").addEventListener("click", () => chat.clear());
$("btnAskMore").addEventListener("click", () => {
  showTab("chat");
  $("chatInput").focus();
});

// ---------------------------------------------------------------- settings
const draft = { apiKeys: { ...settings.apiKeys }, models: { ...settings.models } };

const PRESET_MODELS = {
  openrouter: [
    { id: "", label: "Tự động (Free)", tag: "Khuyên dùng" },
    { id: "google/gemini-2.0-flash-lite-preview:free", label: "Gemini Flash Lite", tag: "Free" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", tag: "Free" }
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tag: "Nhanh" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tag: "Mạnh" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tag: "Ổn định" }
  ],
  openai: [
    { id: "gpt-6-luna", label: "GPT-6 Luna", tag: "Mặc định" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", tag: "Nhẹ" },
    { id: "gpt-4o", label: "GPT-4o", tag: "Cao cấp" }
  ],
  anthropic: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", tag: "Mặc định" },
    { id: "claude-3-5-sonnet-latest", label: "Sonnet 3.5", tag: "Chuẩn" },
    { id: "claude-3-5-haiku-latest", label: "Haiku 3.5", tag: "Nhanh" }
  ],
  compat: [
    { id: "llama3.1", label: "Llama 3.1", tag: "Mặc định" },
    { id: "qwen2.5", label: "Qwen 2.5", tag: "Việt tốt" },
    { id: "deepseek-r1", label: "DeepSeek R1", tag: "Lý luận" }
  ]
};

function syncProviderCards(activeVal) {
  const cards = document.querySelectorAll(".provider-card");
  cards.forEach((c) => {
    const isMatch = c.dataset.provider === activeVal;
    c.classList.toggle("active", isMatch);
    c.setAttribute("aria-checked", String(isMatch));
  });
}

function renderModelChips() {
  const p = $("provider").value;
  const curVal = $("model").value.trim();
  const chipsContainer = $("modelChips");
  if (!chipsContainer) return;

  const presets = [...(PRESET_MODELS[p] || [])];

  if (p === "openrouter") {
    const datalistOpts = [...$("modelList").querySelectorAll("option")].map((o) => o.value);
    for (const id of datalistOpts.slice(0, 6)) {
      if (!presets.some((x) => x.id === id)) {
        const shortName = id.replace(/:free$/, "").split("/").pop();
        presets.push({ id, label: shortName, tag: "Free" });
      }
    }
  }

  chipsContainer.replaceChildren(
    ...presets.map((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isMatch = m.id === curVal;
      btn.className = "model-chip" + (isMatch ? " active" : "");
      btn.dataset.id = m.id;

      const lbl = document.createElement("span");
      lbl.textContent = m.label;
      btn.append(lbl);

      if (m.tag) {
        const tag = document.createElement("span");
        tag.className = "chip-tag";
        tag.textContent = m.tag;
        btn.append(tag);
      }

      btn.addEventListener("click", () => {
        $("model").value = m.id;
        draft.models[p] = m.id;
        renderModelChips();
      });
      return btn;
    })
  );
}

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
  syncProviderCards(p);
  renderModelChips();
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

document.querySelectorAll(".provider-card").forEach((card) => {
  card.addEventListener("click", () => {
    const p = card.dataset.provider;
    if ($("provider").value !== p) {
      stashProviderFields(lastProvider);
      $("provider").value = p;
      lastProvider = p;
      loadProviderFields();
    }
  });
});

$("model").addEventListener("input", () => {
  draft.models[$("provider").value] = $("model").value.trim();
  renderModelChips();
});

// giao diện + nút nổi: lưu ngay khi đổi (nút Lưu không ghi đè các trường này)
$("theme").addEventListener("change", async () => {
  settings = await saveSettings({ theme: $("theme").value });
  applyTheme();
});
$("showFab").addEventListener("change", async () => {
  settings = await saveSettings({ showFab: $("showFab").checked });
});

// ---------------------------------------------------------------- cá nhân hoá AI
// Lưu ngay khi đổi / sau khi ngừng gõ (nút Lưu không ghi đè các trường này); lib/personal.js nối vào cuối prompt.
$("reasoningEffort").value = effortOf(settings);
$("reasoningEffort").addEventListener("change", async () => {
  settings = await saveSettings({ reasoningEffort: $("reasoningEffort").value });
});
for (const id of ["customPrompt", "emailRules", "memory"]) {
  const el = $(id);
  el.value = settings[id] || "";
  const count = () => ($(id + "Count").textContent = `${el.value.length}/${LIMITS[id]}`);
  let timer = 0;
  const persist = async () => {
    clearTimeout(timer);
    settings = await saveSettings({ [id]: el.value.trim() });
  };
  count();
  el.addEventListener("input", () => {
    count();
    clearTimeout(timer);
    timer = setTimeout(persist, 600);
  });
  el.addEventListener("change", persist);
}

function renderExamples() {
  const list = settings.emailExamples || [];
  $("examplesCount").textContent = `${list.length}/${MAX_EXAMPLES}`;
  $("examplesEmpty").hidden = list.length > 0;
  $("emailExamples").replaceChildren(...list.map((text, i) => {
    const li = document.createElement("li");
    const t = Object.assign(document.createElement("span"), { className: "ex-text", textContent: text, title: text });
    const del = Object.assign(document.createElement("button"), { type: "button", className: "ex-del", textContent: "✕", title: "Xoá mẫu này" });
    del.setAttribute("aria-label", "Xoá mẫu này");
    del.addEventListener("click", async () => {
      settings = await saveSettings({ emailExamples: list.filter((_, j) => j !== i) });
      renderExamples();
    });
    li.append(t, del);
    return li;
  }));
}
renderExamples();

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
    renderModelChips();
    setStatus($("settingsStatus"), `Đã tải ${ids.length} model miễn phí - chọn trong ô Model.`);
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
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!(tabId in fnByTab)) return;
  delete fnByTab[tabId];
  saveFnByTab();
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
    chrome.storage.session.remove("pendingSummarize");
    // đổi tab xong mới chuyển sang Tóm tắt, để chức năng được ghi nhớ cho đúng tab
    refreshPage().then(() => {
      showTab("summary");
      runSummary(false, msg.selection ? "selection" : "auto");
    });
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
