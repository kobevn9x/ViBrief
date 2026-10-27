// Dịch Anh ⇄ Việt: Google Translate (miễn phí, không cần key) hoặc LLM.
import { callLLM, parseJSONLoose } from "./llm.js";

const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;

/** Ước lượng đoạn văn có phải tiếng Việt không (theo tỉ lệ ký tự có dấu đặc trưng). */
export function isVietnamese(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (!letters) return false;
  const vi = (text.match(VI_CHARS) || []).length;
  return vi / letters > 0.04;
}

/** Ngôn ngữ đích cho 1 đoạn theo hướng dịch đã chọn. */
export function targetFor(text, direction) {
  if (direction === "en2vi") return "vi";
  if (direction === "vi2en") return "en";
  return isVietnamese(text) ? "en" : "vi";
}

// ---------------- Google Translate (endpoint web công khai) ----------------
const GOOGLE_RETRY_MS = [600, 1800]; // trang dài gửi nhiều request → hay gặp 429; thử lại 2 lần
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleOne(text, target, retries) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" + target;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "q=" + encodeURIComponent(text)
      });
    } catch (e) {
      if (attempt >= retries) throw e; // lỗi mạng
      await sleep(GOOGLE_RETRY_MS[attempt]);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      return (data?.[0] || []).map((seg) => seg?.[0] || "").join("");
    }
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= retries) throw new Error(`Google Translate lỗi HTTP ${res.status}`);
    const after = Number(res.headers.get("retry-after")) * 1000;
    await sleep(Math.min(5000, after > 0 ? after : GOOGLE_RETRY_MS[attempt]));
  }
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

async function googleBatch(texts, target, retries) {
  return mapLimit(texts, 5, async (t) => {
    try { return await googleOne(t, target, retries); } catch { return null; }
  });
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
