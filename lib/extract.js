// Đọc nội dung trang qua chrome.scripting (dùng chung cho side panel, popup và background)

export const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

export function canAccess(tab) {
  return tab?.url && !RESTRICTED.test(tab.url) && !/\.pdf($|[?#])/i.test(tab.url);
}

// Đoạn bôi đen dài hơn ngần này ký tự (đã gộp khoảng trắng) thì chỉ tóm tắt đoạn đó.
// content/fab.js giữ bản sao (không import được module).
export const MIN_SELECTION = 100;

/** Đoạn đang bôi đen trên trang; "" nếu không có. Nhanh: không đọc cả trang. */
export async function getSelectionText(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => String(getSelection() || "").trim()
  });
  return result || "";
}

/** Đoạn chọn đủ dài để tóm tắt riêng (đếm sau khi gộp khoảng trắng). */
export const isLongSelection = (text) => (text || "").replace(/\s+/g, " ").trim().length > MIN_SELECTION;

// Chạy trong trang (phải tự đủ, không dùng biến bên ngoài).
// Thứ tự: <article>/<main> duy nhất (bỏ qua Readability, nhanh) → Readability → body.innerText.
// Readability chưa được nạp thì trả { needReadability: true } để bên gọi nạp rồi chạy lại.
function pageExtractor() {
  const t0 = performance.now();
  const done = (text, method) => ({
    title: document.title,
    url: location.href,
    text,
    fromSelection: false,
    method,
    pageMs: Math.round(performance.now() - t0)
  });

  const only = (list) => (list.length === 1 ? list[0] : null);
  const main = only(document.querySelectorAll("article")) || only(document.querySelectorAll('main, [role="main"]'));
  if (main) {
    const text = main.innerText || "";
    if (text.length >= 1000) {
      let linkChars = 0;
      for (const a of main.querySelectorAll("a")) linkChars += (a.innerText || "").length;
      if (linkChars / text.length < 0.25) return done(text, "article");
    }
  }

  // eslint-disable-next-line no-undef
  if (typeof Readability === "undefined") return { needReadability: true };
  let text = "";
  try {
    // eslint-disable-next-line no-undef
    text = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse()?.textContent || "";
  } catch { /* ignore */ }
  if (text.trim().length >= 400) return done(text, "readability");
  return done(document.body?.innerText || "", "body");
}

/** Đọc cả trang (đoạn bôi đen do getSelectionText xử lý riêng).
 * @returns {Promise<{title,url,text,fromSelection,method:"article"|"readability"|"body",pageMs}>} */
export async function extractPage(tabId) {
  const run = async () => (await chrome.scripting.executeScript({ target: { tabId }, func: pageExtractor }))[0].result;
  let res = await run();
  if (res?.needReadability) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/Readability.js"] });
    res = await run();
  }
  return res;
}
