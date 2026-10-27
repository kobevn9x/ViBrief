// Dịch song ngữ ngay trên trang: chèn bản dịch dưới mỗi đoạn văn.
// Được nạp theo yêu cầu bằng chrome.scripting – an toàn khi nạp nhiều lần.
(() => {
  if (window.__tldrvi) return;

  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th, caption, summary, div, section, article, span";
  const SKIP_SEL = "script, style, noscript, code, pre, kbd, samp, textarea, input, select, button, svg, math, canvas, iframe, [contenteditable=''], [contenteditable='true'], .tldrvi-tr, .tldrvi-badge, .tldrvi-pop, [translate='no'], .notranslate";
  const BLOCK_TAGS = new Set(["P","LI","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","DD","DT","FIGCAPTION","TD","TH","CAPTION","SUMMARY","DIV","SECTION","ARTICLE","UL","OL","TABLE","TR","TBODY","FORM","HEADER","FOOTER","NAV","ASIDE","MAIN","FIGURE","DL","PRE"]);
  const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;
  const MAX_LEN = 4500;

  const state = {
    active: false,
    direction: "auto",
    io: null,
    mo: null,
    queue: new Set(),
    timer: null,
    done: 0,
    total: 0,
    failed: 0,
    inflight: 0,
    cache: new Map(),
    badge: null
  };

  const isVietnamese = (t) => {
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (!letters) return false;
    return (t.match(VI_CHARS) || []).length / letters > 0.04;
  };
  const targetFor = (t) =>
    state.direction === "en2vi" ? "vi" : state.direction === "vi2en" ? "en" : isVietnamese(t) ? "en" : "vi";

  const textOf = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();

  function hasBlockChild(el) {
    for (const c of el.children) {
      if (c.classList.contains("tldrvi-tr")) continue;
      if (BLOCK_TAGS.has(c.tagName)) return true;
      const d = getComputedStyle(c).display;
      if (d === "block" || d === "flex" || d === "grid" || d === "list-item" || d === "table") return true;
    }
    return false;
  }

  /** Đoạn văn hợp lệ: chứa chữ, không có khối con, đủ dài, đang hiển thị. */
  function isCandidate(el) {
    if (el.dataset.tldrvi) return false;
    if (el.closest(SKIP_SEL)) return false;
    if (el.tagName === "SPAN" || el.tagName === "DIV" || el.tagName === "SECTION" || el.tagName === "ARTICLE") {
      // div/span chỉ nhận khi hiển thị dạng khối (span inline thuộc về khối cha)
      const d = getComputedStyle(el).display;
      if (d.startsWith("inline") || d === "contents" || d === "none") return false;
    }
    if (hasBlockChild(el)) return false;
    const t = textOf(el);
    if (t.length < 2 || !/\p{L}{2,}/u.test(t)) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    // tránh đoạn đã đúng ngôn ngữ đích khi ép chiều
    if (state.direction === "en2vi" && isVietnamese(t)) return false;
    if (state.direction === "vi2en" && !isVietnamese(t)) return false;
    return true;
  }

  function scan(root = document.body) {
    if (!state.active || !root) return;
    const els = root.matches?.(BLOCK_SEL) ? [root, ...root.querySelectorAll(BLOCK_SEL)] : root.querySelectorAll(BLOCK_SEL);
    for (const el of els) {
      if (!isCandidate(el)) continue;
      el.dataset.tldrvi = "pending";
      state.total++;
      state.io.observe(el);
    }
    updateBadge();
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      state.io.unobserve(e.target);
      state.queue.add(e.target);
    }
    if (state.queue.size && !state.timer) state.timer = setTimeout(flush, 120);
  }

  function insertTranslation(el, translated, target) {
    if (!state.active || !el.isConnected) return;
    el.querySelector(":scope > .tldrvi-tr")?.remove();
    const span = document.createElement("span");
    span.className = "tldrvi-tr";
    span.lang = target;
    span.textContent = translated;
    el.appendChild(span);
    el.dataset.tldrvi = "done";
  }

  async function flush() {
    state.timer = null;
    const items = [...state.queue];
    state.queue.clear();
    if (!items.length || !state.active) return;

    // nhóm theo ngôn ngữ đích
    const groups = { vi: [], en: [] };
    for (const el of items) {
      const text = textOf(el).slice(0, MAX_LEN);
      const target = targetFor(text);
      const key = target + "|" + text;
      if (state.cache.has(key)) {
        insertTranslation(el, state.cache.get(key), target);
        state.done++;
        continue;
      }
      el.dataset.tldrvi = "loading";
      groups[target].push({ el, text, key });
    }
    updateBadge();

    for (const target of ["vi", "en"]) {
      const g = groups[target];
      for (let i = 0; i < g.length; i += 40) {
        const part = g.slice(i, i + 40);
        let res;
        state.inflight++;
        updateBadge();
        try {
          res = await chrome.runtime.sendMessage({ type: "translate", target, texts: part.map((x) => x.text) });
        } catch (e) {
          res = { ok: false, error: e.message };
        } finally {
          state.inflight--;
        }
        if (!state.active) return;
        part.forEach((x, j) => {
          const tr = res?.ok ? res.translations[j] : null;
          if (tr && tr.trim() && tr.trim() !== x.text) {
            state.cache.set(x.key, tr);
            insertTranslation(x.el, tr, target);
          } else {
            x.el.dataset.tldrvi = tr ? "same" : "error";
            if (!tr) state.failed++;
          }
          state.done++;
        });
        if (!res?.ok) setBadgeError(res?.error || "Lỗi dịch");
        updateBadge();
      }
    }
  }

  // ---------------- badge trạng thái ----------------
  function ensureBadge() {
    if (state.badge?.isConnected) return state.badge;
    const b = document.createElement("div");
    b.className = "tldrvi-badge";
    b.innerHTML = `<span class="tldrvi-badge-dot"></span><span class="tldrvi-badge-text"></span><button type="button" title="Tắt dịch song ngữ">Tắt</button>`;
    b.querySelector("button").addEventListener("click", () => toggle(false));
    document.documentElement.appendChild(b);
    state.badge = b;
    return b;
  }
  function updateBadge() {
    if (!state.active) return;
    const b = ensureBadge();
    const pending = state.total - state.done;
    const label = state.direction === "en2vi" ? "Anh → Việt" : state.direction === "vi2en" ? "Việt → Anh" : "Anh ⇄ Việt";
    b.querySelector(".tldrvi-badge-text").textContent =
      `Song ngữ ${label} · ${state.done}/${state.total}` + (state.failed ? ` · lỗi ${state.failed}` : "");
    b.classList.toggle("is-busy", state.inflight > 0 || state.queue.size > 0);
    b.title = pending > 0 ? "Phần còn lại sẽ được dịch khi bạn cuộn tới" : "";
  }
  function setBadgeError(msg) {
    const b = ensureBadge();
    b.classList.add("is-error");
    b.title = msg;
  }

  // ---------------- bật / tắt ----------------
  function start(direction) {
    state.active = true;
    state.direction = direction || "auto";
    state.done = state.total = state.failed = 0;
    state.io = new IntersectionObserver(onIntersect, { rootMargin: "600px 0px" });
    state.added = new Set();
    state.mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !n.classList.contains("tldrvi-tr")) state.added.add(n);
        }
      }
      if (!state.added.size) return;
      clearTimeout(state.moTimer);
      state.moTimer = setTimeout(() => {
        const nodes = [...state.added];
        state.added.clear();
        for (const n of nodes) if (n.isConnected) scan(n);
      }, 500);
    });
    state.mo.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  function stop() {
    state.active = false;
    state.io?.disconnect();
    state.mo?.disconnect();
    clearTimeout(state.timer);
    state.timer = null;
    state.queue.clear();
    document.querySelectorAll(".tldrvi-tr").forEach((n) => n.remove());
    document.querySelectorAll("[data-tldrvi]").forEach((n) => delete n.dataset.tldrvi);
    state.badge?.remove();
    state.badge = null;
  }

  function toggle(force, direction) {
    const want = force === null || force === undefined ? !state.active : force;
    if (state.active && (!want || (direction && direction !== state.direction))) stop();
    if (want && !state.active) start(direction || state.direction);
    return state.active;
  }

  // ---------------- dịch đoạn đã chọn (popup nổi) ----------------
  async function showSelection(text) {
    text = (text || String(getSelection() || "")).trim().slice(0, MAX_LEN);
    if (!text) return;
    document.querySelector(".tldrvi-pop")?.remove();
    const target = isVietnamese(text) ? "en" : "vi";
    const pop = document.createElement("div");
    pop.className = "tldrvi-pop";
    pop.innerHTML = `<div class="tldrvi-pop-head"><span>${target === "vi" ? "Anh → Việt" : "Việt → Anh"}</span><span class="tldrvi-pop-actions"><button type="button" data-a="copy">Sao chép</button><button type="button" data-a="close" aria-label="Đóng">✕</button></span></div><div class="tldrvi-pop-body">Đang dịch…</div>`;
    const sel = getSelection();
    let top = window.scrollY + 80, left = window.scrollX + 40;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) {
        top = window.scrollY + r.bottom + 8;
        left = window.scrollX + Math.min(Math.max(8, r.left), window.innerWidth - 400);
      }
    }
    pop.style.top = top + "px";
    pop.style.left = left + "px";
    document.documentElement.appendChild(pop);
    const body = pop.querySelector(".tldrvi-pop-body");
    pop.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (a === "close") pop.remove();
      if (a === "copy") navigator.clipboard.writeText(body.textContent).then(() => (e.target.textContent = "Đã chép"));
    });
    const onDocDown = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("mousedown", onDocDown, true); } };
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
    try {
      const res = await chrome.runtime.sendMessage({ type: "translate", target, texts: [text] });
      body.textContent = res?.ok && res.translations[0] ? res.translations[0] : "Không dịch được: " + (res?.error || "lỗi không rõ");
    } catch (e) {
      body.textContent = "Không dịch được: " + e.message;
    }
  }

  window.__tldrvi = {
    toggle,
    showSelection,
    get active() { return state.active; },
    get direction() { return state.direction; }
  };
})();
