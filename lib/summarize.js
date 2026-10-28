import { callLLM, parseJSONLoose, LLMError } from "./llm.js";
import { isVietnamese, translateBatch } from "./translate.js";

// Số ký tự tối đa gửi cho AI theo độ dài tóm tắt: ít token vào → trả lời nhanh hơn, vừa context của model miễn phí
const BUDGET = { short: 12000, medium: 20000, long: 32000 };
// Số token đầu ra tối đa (AI chỉ viết một ngôn ngữ; bản tiếng Anh của chế độ song ngữ do Google dịch)
const OUT_TOKENS = { short: 600, medium: 1000, long: 1600 };

const LENGTH_SPEC = {
  short: { bullets: 3, para: "2-3 sentences" },
  medium: { bullets: 5, para: "4-6 sentences" },
  long: { bullets: 8, para: "2 paragraphs, about 10 sentences total" }
};
// đoạn bôi đen ngắn: ít ý hơn để model không phải "độn" nội dung
const EXCERPT_SPEC = { bullets: 2, para: "1-2 sentences" };

// Định dạng dòng (thay cho JSON) để hiển thị dần được trong lúc AI đang trả lời
const formatSpec = (spec) =>
  `Respond in plain text using EXACTLY this format and nothing else (no JSON, no headings, no preamble):\n` +
  `TLDR: <one-sentence takeaway>\n` +
  `- <key point>\n` +
  `(exactly ${spec.bullets} key-point lines, each one sentence starting with "- "; wrap the 1-3 most important keywords of each point in **double asterisks**)\n` +
  `SUMMARY: <a concise summary of ${spec.para}>`;

const EMPTY = () => ({ tldr: "", bullets: [], summary: "" });
const isEmpty = (b) => !b || (!b.tldr && !b.bullets.length && !b.summary);

// bỏ dấu ** lẻ (đang stream dở hoặc bị dịch làm lệch) để không hiện ** thô
function fixMarks(t) {
  t = t.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, "**$1**");
  return (t.match(/\*\*/g) || []).length % 2 ? t.replace(/\*\*(?!.*\*\*)/, "") : t;
}

const LABEL_TLDR = /^(?:tl;?\s*dr|tldr)\s*[:：]\s*/i;
const LABEL_SUMMARY = /^(?:summary|tóm tắt)\s*[:：]\s*/i;
const LABEL_SKIP = /^(?:key points?|ý chính|bullets?)\s*[:：]?\s*$/i;
const BULLET = /^(?:[-*•]|\d+[.)])\s+/;

/**
 * Đọc câu trả lời dạng dòng thành {tldr, bullets, summary}. Chịu được bản đang stream dở (final = false):
 * dòng cuối chưa xong mà có thể là nhãn (vd "SUMM") thì tạm bỏ qua.
 */
export function parseSummaryText(text, final = true) {
  if (final && /^\s*(?:```[a-z]*\s*)?\{/i.test(text)) {
    const fromJSON = parseJSONBlock(text);
    if (fromJSON) return fromJSON;
  }
  const out = EMPTY();
  let lines = text.replace(/^\s*```[a-z]*\s*$/gim, "").split(/\r?\n/);
  if (!final && /^\s*[A-Za-zÀ-ỹ;]{0,9}$/.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
  let section = null;
  for (let raw of lines) {
    // bỏ markdown thừa quanh nhãn: "**TLDR:**", "## Summary:"
    let line = raw.trim().replace(/^#+\s*/, "").replace(/^\*\*([^*]+?[:：])\*\*\s*/, "$1 ");
    if (!line) continue;
    if (LABEL_TLDR.test(line)) {
      section = "tldr";
      out.tldr = line.replace(LABEL_TLDR, "");
    } else if (LABEL_SUMMARY.test(line)) {
      section = "summary";
      out.summary = line.replace(LABEL_SUMMARY, "");
    } else if (LABEL_SKIP.test(line)) {
      section = "bullets";
    } else if (BULLET.test(line) && section !== "summary") {
      section = "bullets";
      out.bullets.push(line.replace(BULLET, ""));
    } else if (section === "bullets" && out.bullets.length) {
      out.bullets[out.bullets.length - 1] += " " + line;
    } else if (section === "summary") {
      out.summary += (out.summary ? "\n" : "") + line;
    } else if (section === "tldr") {
      out.tldr += " " + line;
    } else if (final) {
      out.summary += (out.summary ? "\n" : "") + line; // không theo định dạng → coi là đoạn tóm tắt
    }
  }
  out.tldr = fixMarks(out.tldr.trim());
  out.bullets = out.bullets.map((b) => fixMarks(b.trim())).filter(Boolean);
  out.summary = fixMarks(out.summary.trim());
  return out;
}

// model bỏ qua định dạng dòng và trả JSON {tldr, bullets, summary} (hoặc {vi: {...}})
function parseJSONBlock(text) {
  try {
    const j = parseJSONLoose(text);
    const b = j.vi || j;
    if (typeof b !== "object" || !b) return null;
    const out = {
      tldr: String(b.tldr || ""),
      bullets: Array.isArray(b.bullets) ? b.bullets.map(String) : [],
      summary: String(b.summary || "")
    };
    return isEmpty(out) ? null : out;
  } catch {
    return null;
  }
}

/** Gộp khoảng trắng, bỏ các dòng ngắn lặp lại (menu, nút, cookie banner…). */
export function normalizeText(text) {
  const seen = new Set();
  const out = [];
  for (let line of text.split("\n")) {
    line = line.replace(/[ \t ]+/g, " ").trim();
    if (line && line.length < 200) {
      if (seen.has(line)) continue;
      seen.add(line);
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Dịch một khối tóm tắt sang `target`: Google (nhanh, miễn phí) trước, lỗi thì dùng AI.
 * `google: false` → chỉ dùng AI (chế độ một ngôn ngữ hứa không gửi bản tóm tắt sang Google).
 */
async function translateBlock(settings, block, target = "en", { google = true } = {}) {
  const texts = [block.tldr, ...block.bullets, block.summary];
  const idx = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const src = idx.map((i) => texts[i]);
  let tr = null;
  let by = "google";
  if (google) {
    try {
      tr = await translateBatch({ ...settings, translateEngine: "google" }, src, target, { retries: 0 });
    } catch { /* thử AI */ }
  }
  if (!tr || tr.some((t) => !t)) {
    by = "llm";
    try {
      tr = await translateBatch({ ...settings, translateEngine: "llm" }, src, target);
    } catch {
      return { block: null, by: null };
    }
  }
  const full = texts.map(() => "");
  idx.forEach((i, j) => (full[i] = fixMarks(String(tr[j] || ""))));
  return {
    block: { tldr: full[0], bullets: full.slice(1, 1 + block.bullets.length), summary: full[full.length - 1] },
    by
  };
}

const CUT_OFF = new Set(["length", "max_tokens", "MAX_TOKENS"]);

const blockText = (b) => [b.tldr, ...b.bullets, b.summary].join("\n");

/**
 * Bản tóm tắt có đúng ngôn ngữ yêu cầu không. Model nhỏ hay viết theo ngôn ngữ của trang (vd. trang tiếng Trung
 * → tóm tắt tiếng Trung) dù đã được dặn → phát hiện để dịch lại.
 */
export function isInLanguage(text, lang) {
  if (lang === "vi") return isVietnamese(text);
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (!letters) return true;
  const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
  return latin / letters > 0.8 && !isVietnamese(text);
}

/**
 * @param {object} settings
 * @param {{title:string,url:string,text:string}} page
 * @param {{signal?:AbortSignal,onUpdate?:(partial:object)=>void}} [opts]
 *   onUpdate: bật streaming – được gọi với kết quả dở dang ({…, streaming: true}) mỗi khi có chữ mới,
 *   và một lần với {translating: true} khi đang thêm bản tiếng Anh.
 * @returns {Promise<{lang:"vi"|"en"|"bi",truncated:boolean,maxChars:number,
 *   primary:{tldr:string,bullets:string[],summary:string},
 *   secondary:{tldr:string,bullets:string[],summary:string}|null,
 *   stats:{chars:number,totalChars:number,ttfbMs?:number,llmMs:number,translateMs?:number,translatedBy?:string,
 *     model?:string,inTok?:number,outTok?:number,retried:boolean}}>}
 */
export async function summarizePage(settings, page, { signal, onUpdate } = {}) {
  let text = normalizeText(page.text);
  if (text.length < 80) throw new Error("Trang này có quá ít nội dung chữ để tóm tắt.");
  let length = LENGTH_SPEC[settings.summaryLength] ? settings.summaryLength : "medium";
  if (page.fromSelection && text.length < 1500) length = "short";
  const spec = page.fromSelection && text.length < 400 ? EXCERPT_SPEC : LENGTH_SPEC[length];
  const maxChars = BUDGET[length];
  const totalChars = text.length;
  const truncated = totalChars > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  let lang = settings.summaryLang;
  if (lang === "auto") lang = isVietnamese(text.slice(0, 3000)) ? "vi" : "en";
  // song ngữ: AI viết tiếng Việt, bản tiếng Anh dịch sau
  const langName = lang === "en" ? "English" : "Vietnamese (tiếng Việt)";
  const system =
    `You summarize web pages for a busy reader. Write everything in ${langName}, regardless of the page language. ` +
    `Be faithful to the source; do not invent facts.\n` +
    (page.fromSelection ? `The content is an excerpt the reader selected on the page; summarize only that excerpt.\n` : "") +
    formatSpec(spec);
  // nhắc lại ngôn ngữ SAU nội dung: model nhỏ dễ "quên" lời dặn trong system prompt khi trang viết bằng thứ tiếng khác
  const user =
    `Title: ${page.title}\nURL: ${page.url}\n\n<content>\n${text}\n</content>\n\n` +
    `Write the summary in ${langName} only, even if the content above is in another language ` +
    `(keep the TLDR:, "- " and SUMMARY: markers as given).`;
  const base = { lang, truncated, maxChars };

  const t0 = performance.now();
  let ttfbMs;
  let acc = "";
  const onDelta = onUpdate
    ? (d) => {
        if (ttfbMs === undefined) ttfbMs = Math.round(performance.now() - t0);
        acc += d;
        onUpdate({ ...base, primary: parseSummaryText(acc, false), secondary: null, streaming: true });
      }
    : undefined;

  const meta = {};
  let retried = false;
  let primary = parseSummaryText(await callLLM(settings, { system, user, maxTokens: OUT_TOKENS[length], signal, meta, onDelta }));
  if (isEmpty(primary) && CUT_OFF.has(meta.finish)) {
    // hết max_tokens trước khi viết được gì (vd. model vẫn "suy nghĩ") → thử lại 1 lần với gấp đôi
    retried = true;
    acc = "";
    primary = parseSummaryText(await callLLM(settings, { system, user, maxTokens: OUT_TOKENS[length] * 2, signal, meta, onDelta }));
  }
  if (isEmpty(primary)) throw new LLMError("AI không trả về bản tóm tắt. Thử lại hoặc đổi model trong Cài đặt.");
  const stats = {
    chars: text.length,
    totalChars,
    ttfbMs,
    llmMs: Math.round(performance.now() - t0),
    model: meta.model,
    inTok: meta.inTok,
    outTok: meta.outTok,
    retried
  };

  // AI vẫn viết sai ngôn ngữ → dịch bản của nó sang ngôn ngữ yêu cầu (song ngữ: dịch song song cả bản tiếng Anh).
  // Chỉ chế độ song ngữ mới gửi bản tóm tắt sang Google; tiếng Việt / English nhờ chính nhà cung cấp AI dịch.
  const want = lang === "en" ? "en" : "vi";
  const wrongLang = !isInLanguage(blockText(primary), want);
  let secondary = null;
  if (wrongLang || lang === "bi") {
    onUpdate?.({ ...base, primary, secondary: null, streaming: true, translating: wrongLang ? want : "en" });
    const t1 = performance.now();
    const [fix, en] = await Promise.all([
      wrongLang ? translateBlock(settings, primary, want, { google: lang === "bi" }) : null,
      lang === "bi" ? translateBlock(settings, primary, "en") : null
    ]);
    if (fix) {
      stats.relangBy = fix.by;
      if (fix.block) primary = fix.block;
    }
    if (en) {
      secondary = en.block;
      stats.translatedBy = en.by;
    }
    stats.translateMs = Math.round(performance.now() - t1);
  }
  return { ...base, primary, secondary, stats };
}
