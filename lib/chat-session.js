// Máy trạng thái của tab "Hỏi đáp": hội thoại theo url, lượt trả lời chạy nền, đọc trang, đoạn bôi đen, lưu session.
// Không đụng DOM, không gọi chrome.* trực tiếp: mọi thứ bên ngoài đi qua `ports` (side panel truyền vào lib/*.js thật,
// test Node truyền bản giả). Panel chỉ vẽ theo các sự kiện bên dưới; chuỗi tiếng Việt nằm ở panel (module chỉ báo mã lỗi).
//
// Sự kiện (session.on(type, fn)); `ctx` là hội thoại liên quan – panel chỉ vẽ khi ctx === session.ctx:
//   state   {ctx, relog}                 hội thoại hiện tại đổi (relog: vẽ lại cả nhật ký; false: chỉ cập nhật nút/thanh ngữ cảnh)
//   status  {ctx, code}                  "reading" (đang đọc trang) | null (xoá trạng thái)
//   started {ctx, job, text, fromChip}   đã đọc xong trang, câu hỏi bắt đầu được trả lời
//   delta   {ctx, job}                   chữ về thêm (job.acc là bản cộng dồn)
//   done    {ctx, job, reply}            xong; aborted {ctx, job, partial} bấm Dừng (partial rỗng nếu chưa có chữ)
//   failed  {ctx, job?, code, message, text, restore, away?}
//           code: "no-key" | "no-access" | "page-read" | "error"; restore: "none" | "ifEmpty" | "always" (trả `text` về ô nhập)
//           away: lỗi xảy ra lúc người dùng ở tab khác, báo lúc quay lại. `job` chỉ có khi bong bóng của lượt đã được vẽ.
import { trimTurns, REPLY_PROMPT } from "./chat.js";

export const MIN_SELECTION_CHARS = 20; // đoạn bôi đen ngắn hơn coi như bôi nhầm, không đưa vào chat
export const MAX_SELECTION_CHARS = 8000;
export const MIN_PAGE_CHARS = 50; // ít hơn mức này coi như không đọc được (vd. trang chưa dựng xong)

/**
 * @param {{
 *   chatWithPage: Function, extractPage: (tabId:number)=>Promise<any>, getSelectionText: (tabId:number, o:object)=>Promise<string>,
 *   canAccess: (tab:object)=>boolean, store: {get:Function,set:Function,clear:Function},
 *   getSettings: ()=>object, saveSettings: (patch:object)=>Promise<any>, hasKey: ()=>boolean
 * }} ports
 */
export function createChatSession(ports) {
  const { store } = ports;
  const handlers = {};
  const emit = (type, e) => {
    for (const fn of handlers[type] || []) {
      try { fn(e); } catch (err) { console.error("chat-session handler:", err); }
    }
  };
  /** Hội thoại đang xem; luôn có (url null khi chưa có tab). */
  let current = newCtx(null);
  // url → hội thoại còn việc chạy nền (đang nạp từ storage hoặc đang có lượt trả lời): sang tab khác không làm mất
  const live = new Map();
  const here = (ctx) => ctx === current;
  const settle = (ctx) => {
    if (!ctx.job && !ctx.hydrating && !ctx.error && live.get(ctx.url) === ctx) live.delete(ctx.url); // lỗi để dành vẫn cần ctx để báo lúc quay lại
  };

  function newCtx(tab) {
    return { url: tab?.url || null, title: tab?.title || "", tab: tab || null, page: null, selection: "", turns: [], job: null, error: null, epoch: 0, hydrating: false, ready: Promise.resolve() };
  }

  // nạp bản đã lưu ở nền; `epoch` đổi (bấm 🗑) hoặc đã có chữ thì bỏ kết quả. Không phụ thuộc "đang xem hay không":
  // lượt gửi trong lúc nạp vẫn phải thấy lịch sử cũ.
  function hydrate(ctx) {
    const epoch = ctx.epoch;
    ctx.hydrating = true;
    ctx.ready = (async () => {
      let cached = null;
      try { cached = await store.get(ctx.url); } catch { /* coi như chưa có */ }
      ctx.hydrating = false;
      settle(ctx);
      if (ctx.epoch !== epoch || ctx.turns.length || ctx.job?.question || !cached || !Array.isArray(cached.turns)) return;
      ctx.page = cached.page || null;
      ctx.selection = cached.selection || "";
      ctx.turns = cached.turns;
      if (here(ctx)) emit("state", { ctx, relog: true });
    })();
  }

  async function save(ctx) {
    if (!ctx.url) return;
    if (!ctx.turns.length) await store.clear(ctx.url);
    else await store.set(ctx.url, { url: ctx.url, title: ctx.title || ctx.tab?.title, page: ctx.page, selection: ctx.selection, turns: ctx.turns });
  }

  /** @returns {Promise<boolean>} false nếu trang đọc được mà việc đọc lỗi/gần như không có chữ; trang hệ thống → true (chat như trợ lý chung). */
  async function readPage(ctx, tab) {
    if (ctx.page || !ports.canAccess(tab)) return true;
    if (here(ctx)) emit("status", { ctx, code: "reading" });
    let page = null;
    try { page = await ports.extractPage(tab.id); } catch { /* báo lỗi ở nơi gọi */ }
    const ok = Boolean(page?.text && page.text.trim().length >= MIN_PAGE_CHARS);
    ctx.page = ok ? page : null;
    if (here(ctx)) {
      emit("status", { ctx, code: null });
      emit("state", { ctx, relog: false });
    }
    return ok;
  }

  return {
    on(type, fn) { (handlers[type] ||= []).push(fn); },
    get ctx() { return current; },
    isBusy: () => Boolean(current.job),
    /** Số hội thoại còn việc chạy nền (test). */
    get liveCount() { return live.size; },

    /**
     * Đổi trang: hoán ctx NGAY (cùng tick với việc panel gán tab), nạp storage ở nền (`ctx.ready`). Gọi lại cùng url là no-op.
     * KHÔNG huỷ lượt đang trả lời: nó chạy tiếp cho trang cũ.
     */
    setPage(tab) {
      const url = tab?.url || null;
      if (url && url === current.url) {
        current.tab = tab || current.tab;
        current.title = tab?.title || current.title;
        return current.ready;
      }
      let ctx = url ? live.get(url) : null;
      if (ctx) {
        ctx.tab = tab;
        ctx.title = tab.title || ctx.title;
      } else {
        ctx = newCtx(tab);
        if (url) {
          live.set(url, ctx);
          hydrate(ctx);
        }
      }
      current = ctx;
      emit("state", { ctx, relog: true });
      if (ctx.error) {
        const { code, message, text } = ctx.error;
        ctx.error = null;
        settle(ctx);
        emit("failed", { ctx, code, message, text, restore: "ifEmpty", away: true });
      }
      return ctx.ready;
    },

    /**
     * Gửi một câu hỏi cho hội thoại hiện tại. Khoá trước (bấm đúp/gửi lần hai bị bỏ qua), rồi mới chờ nạp storage + đọc trang.
     * @param {{text:string, fromChip?:boolean, brief?:object|null}} o
     */
    async send({ text, fromChip = false, brief = null }) {
      text = String(text || "").trim();
      const ctx = current;
      if (!text || ctx.job) return;
      if (!ports.hasKey()) {
        emit("failed", { ctx, code: "no-key", text, restore: "none" });
        return;
      }
      const tab = ctx.tab;
      ctx.title = tab?.title || ctx.title;
      const job = { abort: new AbortController(), question: "", acc: "", discard: false };
      ctx.job = job;
      ctx.error = null;
      if (ctx.url) live.set(ctx.url, ctx);
      emit("state", { ctx, relog: false });
      const release = () => {
        if (ctx.job !== job) return; // đã bị tách ra (bấm 🗑) hoặc đã có lượt mới
        ctx.job = null;
        settle(ctx);
        if (here(ctx)) emit("state", { ctx, relog: false });
      };
      // lỗi lúc người dùng ở tab khác: để dành, báo khi quay lại (setPage)
      const fail = (code, message, restore, started) => {
        if (here(ctx)) emit("failed", { ctx, job: started ? job : undefined, code, message, text, restore });
        else ctx.error = { code, message, text };
      };
      const aborted = () => job.abort.signal.aborted;

      await ctx.ready; // lịch sử/trang đã lưu phải vào ctx trước khi đọc thêm hay gửi
      // đoạn đang bôi đen trên trang (thư/ticket cần trả lời; quét cả iframe) → dính theo hội thoại cho tới khi bôi đoạn khác / bấm 🗑
      if (!aborted() && ports.canAccess(tab)) {
        const sel = await Promise.resolve().then(() => ports.getSelectionText(tab.id, { allFrames: true })).catch(() => "");
        if (String(sel || "").replace(/\s+/g, " ").trim().length >= MIN_SELECTION_CHARS) {
          ctx.selection = sel.slice(0, MAX_SELECTION_CHARS);
          if (here(ctx)) emit("state", { ctx, relog: false });
        }
      }
      const pageOk = aborted() ? false : await readPage(ctx, tab);
      if (aborted() || (!pageOk && !ctx.selection)) {
        // bấm Dừng / đọc trang lỗi mà không có đoạn bôi đen: không gửi, câu đang gõ vẫn còn
        if (!aborted()) fail("page-read", "", "none");
        release();
        return;
      }

      job.question = text;
      emit("started", { ctx, job, text, fromChip });
      const turns = [...ctx.turns, { role: "user", content: text }];
      try {
        const reply = await ports.chatWithPage(ports.getSettings(), {
          page: ctx.page,
          brief,
          selection: ctx.selection,
          turns,
          onDelta: (d) => {
            job.acc += d;
            emit("delta", { ctx, job });
          },
          signal: job.abort.signal
        });
        ctx.turns = trimTurns([...turns, { role: "assistant", content: reply }]);
        emit("done", { ctx, job, reply });
        await save(ctx).catch(() => {}); // đang ở tab khác: vẫn lưu vào hội thoại của trang này; lỗi lưu không làm mất câu trả lời
        if (text.startsWith(REPLY_PROMPT)) {
          // chỉ thẻ ✉️ mới có phần "Phong cách: …" để nhớ cho lần sau (không chờ, lỗi lưu bị nuốt)
          Promise.resolve().then(() => ports.saveSettings({ replyStyle: text.slice(REPLY_PROMPT.length).trim().slice(0, 200) })).catch(() => {});
        }
      } catch (e) {
        if (e?.name === "AbortError") {
          if (job.discard) return; // bấm 🗑 giữa chừng: hội thoại đã xoá, không ghi lại
          // bấm "Dừng": giữ câu hỏi + phần đã viết (nếu có)
          const partial = job.acc.trim() ? job.acc : "";
          ctx.turns = trimTurns(partial ? [...turns, { role: "assistant", content: job.acc }] : turns);
          emit("aborted", { ctx, job, partial });
          await save(ctx).catch(() => {});
        } else {
          fail("error", e?.message || String(e), fromChip ? "ifEmpty" : "always", true);
        }
      } finally {
        release();
      }
    },

    /** Nút Dừng: giữ phần đã viết. */
    stop() { current.job?.abort.abort(); },

    /** Nút 🗑: bỏ lượt đang chạy (không ghi lại), xoá lượt đã lưu + đoạn bôi đen; giữ nội dung trang đã đọc. */
    async clear() {
      const ctx = current;
      const job = ctx.job;
      if (job) {
        job.discard = true;
        job.abort.abort();
        ctx.job = null;
        settle(ctx);
        emit("state", { ctx, relog: false });
      }
      ctx.epoch++; // bản nạp dở dang không được ghi đè lên hội thoại vừa xoá
      ctx.turns = [];
      ctx.selection = ""; // đoạn bôi đen thuộc về hội thoại cũ (vd. thư đã trả lời xong)
      ctx.error = null;
      if (ctx.url) await Promise.resolve().then(() => store.clear(ctx.url)).catch(() => {});
      if (here(ctx)) emit("state", { ctx, relog: true });
    },

    /** Nút ⟳: đọc lại nội dung trang. */
    async refreshPage() {
      const ctx = current;
      if (!ctx.tab || !ports.canAccess(ctx.tab)) {
        emit("failed", { ctx, code: "no-access", text: "", restore: "none" });
        return;
      }
      await ctx.ready;
      ctx.page = null;
      if (!(await readPage(ctx, ctx.tab)) && here(ctx)) emit("failed", { ctx, code: "page-read", text: "", restore: "none" });
    }
  };
}
