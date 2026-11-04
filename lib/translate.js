// Dịch Anh ⇄ Việt: Google Translate (miễn phí, không cần key) hoặc LLM.
import { callLLM, parseJSONLoose } from "./llm.js";
import "./core.js"; // script cổ điển, gán globalThis.__tldrviCore (dùng chung với content script)

const C = globalThis.__tldrviCore;
// Nhận diện tiếng Việt + chọn ngôn ngữ đích: bản duy nhất nằm trong lib/core.js
export const isVietnamese = C.isVietnamese;
export const targetFor = C.targetFor;

// ---------------- Google Translate (endpoint web công khai) ----------------
const GOOGLE_RETRY_MS = [600, 1800]; // trang dài gửi nhiều request → hay gặp 429; thử lại 2 lần
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GoogleError extends Error {
  constructor(status) {
    super(`Google Translate lỗi HTTP ${status}`);
    this.retriable = status === 429 || status >= 500;
  }
}

/** POST form tới Google, thử lại khi 429/5xx/lỗi mạng. Trả về JSON đã parse. */
async function googlePost(url, body, retries) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body
      });
    } catch (e) {
      if (attempt >= retries) throw Object.assign(e, { retriable: true }); // lỗi mạng
      await sleep(GOOGLE_RETRY_MS[attempt]);
      continue;
    }
    if (res.ok) return res.json();
    const err = new GoogleError(res.status);
    if (!err.retriable || attempt >= retries) throw err;
    const after = Number(res.headers.get("retry-after")) * 1000;
    await sleep(Math.min(5000, after > 0 ? after : GOOGLE_RETRY_MS[attempt]));
  }
}

async function googleOne(text, target, retries) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" + target;
  const data = await googlePost(url, "q=" + encodeURIComponent(text), retries);
  return (data?.[0] || []).map((seg) => seg?.[0] || "").join("");
}

/**
 * Nhiều đoạn trong 1 request (endpoint `translate_a/t`, nhiều tham số q): nhanh hơn hẳn 1 request/đoạn.
 * Trả về [[bản dịch, ngôn ngữ nguồn], …] đúng thứ tự gửi; sai định dạng → ném lỗi không thử lại.
 */
async function googleMulti(texts, target, retries) {
  const url = "https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=" + target;
  const data = await googlePost(url, texts.map((t) => "q=" + encodeURIComponent(t)).join("&"), retries);
  const out = Array.isArray(data) && data.length === texts.length
    ? data.map((x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : null))
    : null;
  if (!out || out.includes(null)) throw new Error("Google Translate trả về sai định dạng");
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const MULTI_ITEMS = 25; // mỗi request tối đa 25 đoạn / ~5000 ký tự; các lô chạy song song
const MULTI_CHARS = 5000;
let multiUnsupported = false; // endpoint nhiều đoạn lỗi định dạng / 4xx → dùng 1 request/đoạn cho tới khi service worker khởi động lại

async function googleSingles(texts, target, retries) {
  return mapLimit(texts, 5, async (t) => {
    try { return await googleOne(t, target, retries); } catch { return null; }
  });
}

async function googleBatch(texts, target, retries) {
  if (multiUnsupported) return googleSingles(texts, target, retries);
  const chunks = [];
  let cur = [], len = 0;
  for (const t of texts) {
    if (cur.length && (cur.length >= MULTI_ITEMS || len + t.length > MULTI_CHARS)) { chunks.push(cur); cur = []; len = 0; }
    cur.push(t); len += t.length;
  }
  if (cur.length) chunks.push(cur);
  const results = await mapLimit(chunks, 4, async (c) => {
    try {
      return await googleMulti(c, target, retries);
    } catch (e) {
      if (e.retriable) return c.map(() => null); // đang bị giới hạn lượt gọi: gọi lẻ từng đoạn chỉ tệ hơn
      multiUnsupported = true; // Google đổi/bỏ endpoint → quay về cách cũ
      return googleSingles(c, target, retries);
    }
  });
  return results.flat();
}

// ---------------- LLM ----------------
const LANG_NAME = { vi: "Vietnamese", en: "English" };

async function llmBatch(settings, texts, target) {
  const system =
    `You are a professional translator. Translate each item of the JSON array into natural, fluent ${LANG_NAME[target]}. ` +
    `Keep meaning exact; keep names, numbers, code, URLs and technical terms as appropriate. ` +
    `Return ONLY a JSON object {"t": [...]} whose array has exactly the same length and order as the input.`;
  const raw = await callLLM(settings, {
    system,
    user: JSON.stringify(texts),
    maxTokens: Math.min(8000, 400 + texts.join("").length * 2),
    json: true
  });
  const parsed = parseJSONLoose(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.t;
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error("AI trả về số đoạn dịch không khớp.");
  }
  return arr.map((x) => (typeof x === "string" ? x : String(x ?? "")));
}

/**
 * Dịch 1 đoạn bằng AI, chữ về dần qua `onDelta(phầnMới)` (popup dịch đoạn bôi đen).
 * Prompt dạng văn bản thường để stream được (bản theo lô cần JSON hoàn chỉnh mới đọc được).
 */
export async function translateStream(settings, text, target, { onDelta, signal } = {}) {
  const system =
    `You are a professional translator. Translate the user's text into natural, fluent ${LANG_NAME[target]}. ` +
    `Keep meaning exact; keep names, numbers, code, URLs and technical terms as appropriate; keep line breaks. ` +
    `Output ONLY the translation, with no quotes, notes or explanations.`;
  const out = await callLLM(settings, {
    system,
    user: text,
    maxTokens: Math.min(8000, 400 + text.length * 2),
    onDelta,
    signal
  });
  return String(out || "").trim();
}

/**
 * Dịch nhiều đoạn sang cùng 1 ngôn ngữ đích. Trả về mảng (null = lỗi đoạn đó).
 * `retries`: số lần thử lại Google khi 429/5xx/lỗi mạng (tóm tắt đặt 0 để chuyển sang AI ngay).
 */
export async function translateBatch(settings, texts, target, { retries = GOOGLE_RETRY_MS.length } = {}) {
  if (!texts.length) return [];
  if (settings.translateEngine === "llm") {
    // chia nhỏ để không vượt giới hạn output
    const chunks = [];
    let cur = [], len = 0;
    for (const t of texts) {
      if (cur.length && (cur.length >= 25 || len + t.length > 6000)) { chunks.push(cur); cur = []; len = 0; }
      cur.push(t); len += t.length;
    }
    if (cur.length) chunks.push(cur);
    const results = await mapLimit(chunks, 2, (c) => llmBatch(settings, c, target));
    return results.flat();
  }
  return googleBatch(texts, target, Math.min(retries, GOOGLE_RETRY_MS.length));
}
