// Hiển thị kết quả tóm tắt (chuỗi HTML / văn bản) + cache trong chrome.storage.session.
// Không đụng DOM – dùng chung cho side panel và popup.

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const highlight = (s) => escapeHTML(s).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>");
const stripMd = (s) => String(s).replace(/\*\*(.+?)\*\*/g, "$1");

// bản chính + (nếu có) bản tiếng Anh bên dưới
const pair = (main, alt) => highlight(main) + (alt ? `<span class="alt" lang="en">${highlight(alt)}</span>` : "");

/**
 * @returns {string} HTML đã escape, `**x**` → `<mark>x</mark>`.
 * Kết quả đang stream (`result.streaming`) chỉ hiện các phần đã có chữ; khung chứa nên có class
 * `streaming` để hiện con trỏ nhấp nháy sau phần cuối.
 */
export function renderSummaryHTML(result) {
  const p = result.primary || result; // kết quả cache dạng cũ {tldr, bullets, summary}
  const sec = result.primary ? result.secondary : null;
  const bullets = p.bullets || [];
  const partial = Boolean(result.streaming);
  let html = "";
  if (p.tldr) html += `<p class="tldr">${pair(p.tldr, sec?.tldr)}</p>`;
  if (!partial || bullets.length || p.summary) {
    html += `<h3>Ý chính</h3>`;
    html += `<ol class="bullets">${bullets.map((b, i) => `<li>${pair(b, sec?.bullets?.[i])}</li>`).join("")}</ol>`;
  }
  if (p.summary) {
    html += `<h3>Tóm tắt</h3>`;
    html += `<p class="para">${pair(p.summary || "", sec?.summary)}</p>`;
  }
  if (partial) {
    if (result.translating === "vi") html += `<p class="note">AI trả lời sai ngôn ngữ – đang dịch sang tiếng Việt…</p>`;
    else if (result.translating) html += `<p class="note">Đang thêm bản tiếng Anh…</p>`;
    return html;
  }
  const notes = [];
  if (result.truncated) {
    const n = (result.maxChars || 60000).toLocaleString("vi-VN");
    notes.push(`Trang rất dài – chỉ phần đầu (~${n} ký tự) được tóm tắt.`);
  }
  if (result.fromSelection) notes.push("Tóm tắt dựa trên đoạn văn bạn đang bôi đen.");
  if (notes.length) html += `<p class="note">${escapeHTML(notes.join(" "))}</p>`;
  return html;
}

const plainBlock = (b) =>
  `${stripMd(b.tldr || "")}\n\n` + (b.bullets || []).map((x) => "• " + stripMd(x)).join("\n") + `\n\n${stripMd(b.summary || "")}`;

export function summaryToPlainText(result, url) {
  const p = result.primary || result;
  const sec = result.primary ? result.secondary : null;
  let out = plainBlock(p);
  if (sec) out += `\n\n— English —\n${plainBlock(sec)}`;
  return out + `\n\n${url || ""}`;
}

// ---------------------------------------------------------------- cache
export const cacheKey = (settings, url) => `sum|${settings.summaryLang}|${settings.summaryLength}|${url}`;

export async function getCachedSummary(settings, url) {
  const k = cacheKey(settings, url);
  return (await chrome.storage.session.get(k))[k] || null;
}

export async function setCachedSummary(settings, url, result) {
  await chrome.storage.session.set({ [cacheKey(settings, url)]: result });
}

export async function clearCachedSummary(settings, url) {
  await chrome.storage.session.remove(cacheKey(settings, url));
}
