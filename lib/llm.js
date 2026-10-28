// Gọi LLM theo provider đã chọn. Dùng được ở service worker và side panel.

export class LLMError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // HTTP status nếu có
  }
}

function friendlyError(status, detail) {
  if (status === 401 || status === 403) return `API key không hợp lệ hoặc không có quyền (HTTP ${status}). ${detail}`;
  if (status === 404) return `Không tìm thấy model/endpoint (HTTP 404) – kiểm tra tên model trong Cài đặt. ${detail}`;
  if (status === 429) return `Vượt giới hạn tốc độ/hạn mức của nhà cung cấp (HTTP 429). Thử lại sau. ${detail}`;
  if (status >= 500) return `Máy chủ AI đang lỗi (HTTP ${status}). Thử lại sau.`;
  return `Lỗi HTTP ${status}. ${detail}`;
}

// Gửi POST, ném LLMError (kèm HTTP status) nếu lỗi kết nối hoặc status không thành công
async function request(url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new LLMError(`Không kết nối được tới ${new URL(url).host}: ${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not json */ }
    const detail = data?.error?.message || data?.message || text.slice(0, 200);
    throw new LLMError(friendlyError(res.status, detail), res.status);
  }
  return res;
}

async function postJSON(url, headers, body, signal) {
  const text = await (await request(url, headers, body, signal)).text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  if (!data) throw new LLMError("Phản hồi không phải JSON: " + text.slice(0, 200));
  return data;
}

/**
 * POST và đọc Server-Sent Events: gọi onData(json) cho mỗi sự kiện `data:`.
 * Máy chủ không stream (trả JSON thường) thì trả về JSON đó để bên gọi xử lý như bình thường.
 */
async function postSSE(url, headers, body, signal, onData) {
  const res = await request(url, { accept: "text/event-stream", ...headers }, body, signal);
  if (!/text\/event-stream/i.test(res.headers.get("content-type") || "")) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new LLMError("Phản hồi không phải JSON: " + text.slice(0, 200)); }
  }
  const handle = (evt) => {
    const data = evt
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    let json;
    try { json = JSON.parse(data); } catch { return; } // dòng chú thích / keep-alive
    onData(json);
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      handle(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
  }
  if (buf.trim()) handle(buf);
  return null;
}

const OPENROUTER = "https://openrouter.ai/api/v1";
let autoModel = null; // model miễn phí đã tự chọn (ghi nhớ trong phiên)
const reasoningOffRejected = new Set(); // model từ chối reasoning.effort = "none"

// Ưu tiên model không có reasoning (trả lời nhanh hơn): 0 = không reasoning, 1 = không rõ, 2 = có reasoning
function reasoningRank(m) {
  const p = m.supported_parameters;
  if (!Array.isArray(p)) return 1;
  return p.includes("reasoning") || p.includes("include_reasoning") ? 2 : 0;
}

/** Danh sách id model miễn phí của OpenRouter: model không reasoning trước, còn lại giữ thứ tự của API. */
export async function listOpenRouterFreeModels() {
  let res;
  try {
    res = await fetch(`${OPENROUTER}/models`);
  } catch (e) {
    throw new LLMError(`Không kết nối được tới openrouter.ai: ${e.message}`);
  }
  if (!res.ok) throw new LLMError(`Không tải được danh sách model của OpenRouter (HTTP ${res.status}).`);
  let data;
  try { data = await res.json(); } catch { throw new LLMError("Danh sách model của OpenRouter không phải JSON."); }
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((m) => {
      if (!m?.id) return false;
      const free = m.id.endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0");
      if (!free) return false;
      const arch = m.architecture || {};
      if (Array.isArray(arch.output_modalities)) return arch.output_modalities.includes("text");
      if (typeof arch.modality === "string" && arch.modality.includes("->")) return arch.modality.split("->")[1].includes("text");
      return true;
    })
    .map((m, i) => ({ id: m.id, rank: reasoningRank(m), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((m) => m.id);
}

/** Model sẽ dùng; OpenRouter để trống model thì tự chọn model miễn phí đầu tiên (ưu tiên không reasoning). */
export async function resolveModel(s) {
  const model = s.models[s.provider];
  if (s.provider !== "openrouter" || model) return model;
  if (autoModel) return autoModel;
  const ids = await listOpenRouterFreeModels();
  if (!ids.length) throw new LLMError("OpenRouter hiện không có model miễn phí nào. Hãy nhập tên model trong Cài đặt.");
  autoModel = ids[0];
  return autoModel;
}

/**
 * @param {object} s settings
 * @param {{system:string,user:string,maxTokens?:number,json?:boolean,signal?:AbortSignal,meta?:object,onDelta?:(text:string)=>void}} req
 *   meta (tuỳ chọn) được điền {model, inTok, outTok, finish} để đo lường.
 *   onDelta (tuỳ chọn): bật streaming, được gọi với từng đoạn chữ mới; hàm vẫn trả về toàn bộ câu trả lời.
 * @returns {Promise<string>}
 */
export async function callLLM(s, { system, user, maxTokens = 2048, json = false, signal, meta = {}, onDelta }) {
  const provider = s.provider;
  const model = s.models[provider];
  const key = s.apiKeys[provider];
  if (provider !== "compat" && !key) {
    throw new LLMError("Chưa nhập API key. Mở tab Cài đặt để thêm key.");
  }

  if (provider === "anthropic") {
    const url = "https://api.anthropic.com/v1/messages";
    const headers = {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
    const readFull = (data) => {
      Object.assign(meta, { model, inTok: data.usage?.input_tokens, outTok: data.usage?.output_tokens, finish: data.stop_reason });
      return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    };
    if (!onDelta) return readFull(await postJSON(url, headers, body, signal));
    let out = "";
    meta.model = model;
    const full = await postSSE(url, headers, { ...body, stream: true }, signal, (ev) => {
      if (ev.type === "error") throw new LLMError(ev.error?.message || "Anthropic báo lỗi khi đang trả lời.");
      if (ev.type === "message_start") meta.inTok = ev.message?.usage?.input_tokens;
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        out += ev.delta.text;
        onDelta(ev.delta.text);
      }
      if (ev.type === "message_delta") {
        meta.finish = ev.delta?.stop_reason ?? meta.finish;
        meta.outTok = ev.usage?.output_tokens ?? meta.outTok;
      }
    });
    return full ? emitAll(readFull(full), onDelta) : out;
  }

  if (provider === "gemini") {
    const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
    const headers = { "x-goog-api-key": key };
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    };
    if (json) body.generationConfig.responseMimeType = "application/json";
    // một phản hồi (hoặc một sự kiện stream) của Gemini → phần chữ + số đo
    const readChunk = (data) => {
      Object.assign(meta, {
        model,
        inTok: data.usageMetadata?.promptTokenCount ?? meta.inTok,
        outTok: data.usageMetadata?.candidatesTokenCount ?? meta.outTok,
        finish: data.candidates?.[0]?.finishReason ?? meta.finish
      });
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    };
    const empty = () => new LLMError("Gemini không trả về nội dung (có thể bị chặn bởi bộ lọc an toàn).");
    if (!onDelta) {
      const out = readChunk(await postJSON(`${base}:generateContent`, headers, body, signal));
      if (!out) throw empty();
      return out;
    }
    let out = "";
    const full = await postSSE(`${base}:streamGenerateContent?alt=sse`, headers, body, signal, (ev) => {
      if (ev.error) throw new LLMError(ev.error.message || "Gemini báo lỗi khi đang trả lời.");
      const t = readChunk(ev);
      if (t) {
        out += t;
        onDelta(t);
      }
    });
    if (full) out = emitAll(readChunk(Array.isArray(full) ? full[0] || {} : full), onDelta);
    if (!out) throw empty();
    return out;
  }

  if (provider === "openrouter") {
    const orModel = await resolveModel(s);
    const headers = {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://github.com/kobevn9x/ViBrief",
      "X-Title": "Lan Brieft"
    };
    const body = {
      model: orModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: maxTokens
    };
    // tắt reasoning để trả lời nhanh; model bắt buộc reasoning sẽ trả 400 → gọi lại không kèm tham số này
    if (!reasoningOffRejected.has(orModel)) body.reasoning = { effort: "none" };
    try {
      return await chatCompletions(`${OPENROUTER}/chat/completions`, headers, body, signal, meta, onDelta);
    } catch (e) {
      if (!(e instanceof LLMError) || e.status !== 400 || !body.reasoning) throw e;
      reasoningOffRejected.add(orModel);
      delete body.reasoning;
      return chatCompletions(`${OPENROUTER}/chat/completions`, headers, body, signal, meta, onDelta);
    }
  }

  // openai + compat dùng Chat Completions
  const base = provider === "compat" ? s.compatBaseUrl.replace(/\/+$/, "") : "https://api.openai.com/v1";
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (json && provider === "openai") body.response_format = { type: "json_object" };
  if (onDelta && provider === "openai") body.stream_options = { include_usage: true };
  return chatCompletions(`${base}/chat/completions`, headers, body, signal, meta, onDelta);
}

// Câu trả lời không stream được (máy chủ trả JSON thường) → đẩy một lần cho onDelta
function emitAll(text, onDelta) {
  if (text) onDelta(text);
  return text;
}

// Chat Completions (OpenRouter / OpenAI / compat), có hoặc không stream
async function chatCompletions(url, headers, body, signal, meta, onDelta) {
  if (!onDelta) {
    const data = await postJSON(url, headers, body, signal);
    Object.assign(meta, readChatUsage(data, data.model || body.model));
    return data.choices?.[0]?.message?.content || "";
  }
  let out = "";
  meta.model = body.model;
  const full = await postSSE(url, headers, { ...body, stream: true }, signal, (ev) => {
    if (ev.error) throw new LLMError(ev.error.message || "AI báo lỗi khi đang trả lời.", ev.error.code);
    if (ev.model) meta.model = ev.model;
    const choice = ev.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) {
      out += delta;
      onDelta(delta);
    }
    if (choice?.finish_reason) meta.finish = choice.finish_reason;
    if (ev.usage) {
      meta.inTok = ev.usage.prompt_tokens;
      meta.outTok = ev.usage.completion_tokens;
    }
  });
  if (!full) return out;
  Object.assign(meta, readChatUsage(full, full.model || body.model));
  return emitAll(full.choices?.[0]?.message?.content || "", onDelta);
}

// số token + lý do dừng theo định dạng Chat Completions
function readChatUsage(data, model) {
  return {
    model,
    inTok: data.usage?.prompt_tokens,
    outTok: data.usage?.completion_tokens,
    finish: data.choices?.[0]?.finish_reason
  };
}

/** Lấy object JSON từ câu trả lời (chịu được ```json fences / text thừa). */
export function parseJSONLoose(text) {
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
  }
  throw new LLMError("Không đọc được JSON từ câu trả lời của AI.");
}
