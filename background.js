import { getSettings, hasLLMKey } from "./lib/settings.js";
import { translateBatch } from "./lib/translate.js";
import { canAccess, extractPage, getSelectionText, isLongSelection, MIN_SELECTION } from "./lib/extract.js";
import { summarizePage } from "./lib/summarize.js";
import { renderSummaryHTML, getCachedSummary, setCachedSummary, clearCachedSummary, cacheKey } from "./lib/summary-view.js";

// Bấm icon → mở popup tóm tắt nhanh (side panel mở bằng Alt+S, menu chuột phải hoặc nút trong popup)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "tldrvi-page", title: "Dịch song ngữ trang này (Anh ⇄ Việt)", contexts: ["page"] });
    chrome.contextMenus.create({ id: "tldrvi-selection", title: "Dịch đoạn đã chọn: \"%s\"", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "tldrvi-summarize", title: "Tóm tắt trang này", contexts: ["page"] });
    chrome.contextMenus.create({ id: "tldrvi-summarize-selection", title: "Tóm tắt đoạn đã chọn", contexts: ["selection"] });
  });
});

/** Nạp content script dịch song ngữ vào tab (an toàn nếu nạp lại). */
async function ensureBilingual(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/bilingual.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/bilingual.js"] });
}

/** Bật/tắt (hoặc ép bật/tắt) dịch song ngữ. Trả về trạng thái mới. */
export async function toggleBilingual(tabId, force) {
  await ensureBilingual(tabId);
  const s = await getSettings();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (force, direction) => window.__tldrvi.toggle(force, direction),
    args: [force ?? null, s.translateDirection]
  });
  return result;
}

// sidePanel.open chỉ chạy khi còn user gesture: phải gọi trước mọi await trong handler
// (await trước đó làm Chrome từ chối mở panel mà không báo gì ra giao diện).
async function openPanelAndSummarize(tab, { selection = false } = {}) {
  const pending = chrome.storage.session.set({ pendingSummarize: { tabId: tab.id, selection } });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await pending;
  chrome.runtime.sendMessage({ type: "summarize-now", tabId: tab.id, selection }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === "tldrvi-page") await toggleBilingual(tab.id, true);
    if (info.menuItemId === "tldrvi-summarize") await openPanelAndSummarize(tab);
    if (info.menuItemId === "tldrvi-summarize-selection") await openPanelAndSummarize(tab, { selection: true });
    if (info.menuItemId === "tldrvi-selection") {
      await ensureBilingual(tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => window.__tldrvi.showSelection(text),
        args: [info.selectionText || ""]
      });
    }
  } catch (e) {
    console.warn("Lan Brieft:", e);
  }
});

// Alt+S là "_execute_action" (Chrome tự mở popup, không qua onCommand)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-bilingual") return;
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await toggleBilingual(tab.id);
  } catch (e) {
    console.warn("Lan Brieft:", e);
  }
});

// Tóm tắt đang chạy theo khoá cache: { promise, partial, listeners } – popup, nút nổi và side panel hỏi cùng lúc
// chỉ gọi AI 1 lần và cùng nhận chữ đang stream. Chạy ở background nên đóng popup giữa chừng không mất kết quả.
const inflight = new Map();
const PARTIAL_EVERY_MS = 50; // gửi bản dở dang tối đa ~20 lần/giây

/**
 * Tóm tắt 1 tab: đoạn bôi đen → cache → gộp yêu cầu trùng → lấy nội dung → gọi AI (stream) → ghi cache + số đo.
 * scope: "auto" (đoạn chọn > MIN_SELECTION ký tự thì tóm tắt đoạn đó, không thì cả trang),
 *   "selection" (bắt buộc có đoạn chọn đủ dài), "page" (bỏ qua đoạn chọn).
 * onPartial (tuỳ chọn) nhận kết quả dở dang trong lúc AI đang trả lời.
 */
async function summarizeTab(tab, { force = false, scope = "auto", onPartial } = {}) {
  const s = await getSettings();
  if (!canAccess(tab)) throw new Error("Không thể đọc trang này.");
  // đọc đoạn chọn TRƯỚC cache: trang đã tóm tắt rồi vẫn tóm tắt được riêng đoạn vừa bôi đen
  const sel = scope === "page" ? "" : await getSelectionText(tab.id).catch(() => "");
  const useSel = isLongSelection(sel);
  if (scope === "selection" && !useSel) {
    throw new Error(sel ? `Hãy bôi đen đoạn dài hơn ${MIN_SELECTION} ký tự để tóm tắt.` : "Đoạn bôi đen đã bị bỏ chọn – hãy bôi đen lại.");
  }
  if (!useSel) {
    if (force) await clearCachedSummary(s, tab.url);
    else {
      const cached = await getCachedSummary(s, tab.url);
      if (cached) return { result: cached, cached: true };
    }
  }
  if (!hasLLMKey(s)) {
    throw new Error("Chưa có API key. Bấm icon Lan Brieft → Mở bảng đầy đủ → Cài đặt để nhập key OpenRouter (miễn phí).");
  }
  // đoạn chọn không lưu cache và không gộp với yêu cầu tóm tắt cả trang
  const key = useSel ? `sel|${tab.url}|${sel}` : cacheKey(s, tab.url);
  let job = inflight.get(key);
  if (!job) {
    job = { partial: null, listeners: new Set() };
    let lastSent = 0;
    let timer = null;
    const flush = () => {
      timer = null;
      lastSent = Date.now();
      for (const fn of job.listeners) fn(job.partial);
    };
    const onUpdate = (partial) => {
      job.partial = partial;
      if (timer) return;
      const wait = PARTIAL_EVERY_MS - (Date.now() - lastSent);
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    };
    job.promise = (async () => {
      const t0 = performance.now();
      const page = useSel
        ? { title: tab.title || "", url: tab.url, text: sel, fromSelection: true, method: "selection" }
        : await extractPage(tab.id);
      const extractMs = Math.round(performance.now() - t0);
      const res = await summarizePage(s, page, { onUpdate });
      clearTimeout(timer);
      res.fromSelection = page.fromSelection;
      res.stats = { method: page.method, extractMs, pageMs: page.pageMs, ...res.stats, totalMs: Math.round(performance.now() - t0) };
      if (res.stats.ttfbMs !== undefined) res.stats.ttfbMs += extractMs; // tính từ lúc bấm
      console.info("Lan Brieft: tóm tắt", tab.url, res.stats);
      if (!page.fromSelection) await setCachedSummary(s, tab.url, res);
      return res;
    })();
    inflight.set(key, job);
    job.promise.then(
      () => inflight.delete(key),
      () => inflight.delete(key)
    );
  }
  if (onPartial) {
    job.listeners.add(onPartial);
    if (job.partial) onPartial(job.partial); // vào sau: nhận ngay phần đã có
  }
  try {
    return { result: await job.promise, cached: false };
  } finally {
    if (onPartial) job.listeners.delete(onPartial);
  }
}

// Xác định tab cần tóm tắt: trang của extension (popup, side panel) chỉ định tabId;
// content script chỉ tóm tắt được chính tab của nó.
async function targetTab(sender, tabId) {
  const fromExtPage = Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
  const tab = fromExtPage && tabId ? await chrome.tabs.get(tabId) : sender.tab;
  if (!tab?.id) throw new Error("Không thể đọc trang này.");
  return tab;
}

const SCOPES = new Set(["auto", "selection", "page"]);

// Kênh "summarize": client gửi {tabId?, force?, scope?}; background gửi lại
// {type:"partial", result, html} nhiều lần rồi {type:"done", result, html, cached} hoặc {type:"error", error}.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize") return;
  let open = true;
  port.onDisconnect.addListener(() => (open = false));
  const post = (msg) => {
    if (!open) return;
    try { port.postMessage(msg); } catch { open = false; }
  };
  port.onMessage.addListener(async (msg) => {
    try {
      const tab = await targetTab(port.sender, msg?.tabId);
      const { result, cached } = await summarizeTab(tab, {
        force: Boolean(msg?.force),
        scope: SCOPES.has(msg?.scope) ? msg.scope : "auto",
        onPartial: (p) => post({ type: "partial", result: p, html: renderSummaryHTML(p) })
      });
      post({ type: "done", result, cached, html: renderSummaryHTML(result) });
    } catch (e) {
      post({ type: "error", error: e?.message || String(e) });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "translate") {
    (async () => {
      try {
        const s = await getSettings();
        const translations = await translateBatch(s, msg.texts, msg.target);
        sendResponse({ ok: true, translations });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async
  }
  if (msg?.type === "toggle-bilingual") {
    toggleBilingual(msg.tabId, msg.force)
      .then((active) => sendResponse({ ok: true, active }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "summarize-tab") {
    // dạng không stream (chờ kết quả cuối); giao diện dùng kênh "summarize" ở trên
    (async () => {
      const tab = await targetTab(sender, msg.tabId);
      const { result, cached } = await summarizeTab(tab, { force: Boolean(msg.force), scope: SCOPES.has(msg.scope) ? msg.scope : "auto" });
      return { ok: true, result, cached, html: renderSummaryHTML(result) };
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg?.type === "translate-selection") {
    // từ nút "Dịch đoạn này" của nút nổi: chỉ dịch được vùng chọn của chính tab gửi
    (async () => {
      if (!sender.tab?.id) throw new Error("Không thể dịch trang này.");
      await ensureBilingual(sender.tab.id);
      await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, func: () => window.__tldrvi.showSelection("") });
      return { ok: true };
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg?.type === "open-panel") {
    // Gọi ngay (không await trước) để còn giữ user gesture từ cú bấm trên trang
    try {
      chrome.sidePanel
        .open({ tabId: sender.tab.id })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
      return;
    }
    return true;
  }
});
