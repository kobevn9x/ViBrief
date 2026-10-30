// Dịch song ngữ ngay trên trang: chèn bản dịch dưới mỗi đoạn văn.
// Được nạp theo yêu cầu bằng chrome.scripting – an toàn khi nạp nhiều lần.
(() => {
  // Bản cũ còn sống thì giữ nguyên. Sau khi extension cập nhật/tải lại, bản cũ vẫn nằm trên trang
  // nhưng chrome.runtime đã chết ("Extension context invalidated") → dọn nó rồi khởi tạo lại.
  const old = window.__tldrvi;
  if (old) {
    let alive = false;
    try { alive = Boolean(old.alive?.()); } catch { /* bản cũ hỏng */ }
    if (alive) return;
    try { old.stop ? old.stop() : old.toggle?.(false); } catch { /* ignore */ }
  }

  const SKIP_SEL = "script, style, noscript, template, code, pre, kbd, samp, textarea, input, select, option, button, svg, math, canvas, iframe, [contenteditable=''], [contenteditable='true'], .tldrvi-tr, .tldrvi-badge, .tldrvi-pop, [translate='no'], .notranslate";
  const OURS_SEL = ".tldrvi-tr, .tldrvi-badge, .tldrvi-pop";
  const BLOCK_TAGS = new Set(["P","LI","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","DD","DT","FIGCAPTION","TD","TH","CAPTION","SUMMARY","DIV","SECTION","ARTICLE","UL","OL","TABLE","TR","TBODY","FORM","HEADER","FOOTER","NAV","ASIDE","MAIN","FIGURE","DL","PRE"]);
  // menu, tab, nút…: bản dịch ngắn đặt cùng dòng thay vì chèn khối mới (tránh vỡ bố cục)
  const INLINE_CTX = "nav, menu, [role='navigation'], [role='menu'], [role='menubar'], [role='menuitem'], [role='tablist'], [role='tab'], [role='button'], [role='toolbar']";
  const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;
  const HAS_WORD = /\p{L}{2,}/u;
  const MAX_LEN = 4500;
  const MAX_RESETS = 3; // trang render lại liên tục (SPA) → thôi chèn lại sau 3 lần
  const RETRY_MS = 4000;
  const MO_OPTS = { childList: true, subtree: true, characterData: true };

  // Kiểu của bản dịch: chèn vào document và vào từng shadow root (insertCSS không áp vào shadow DOM).
  const TR_CSS = `
:root {
  --tldrvi-accent: #2f9e7a;
}
:root[data-theme="pink"], [data-tldrvi-theme="pink"] {
  --tldrvi-accent: #9e2053;
}
.tldrvi-tr {
  display: block !important;
  margin: 0.35em 0 0.2em !important;
  padding: 0 0 0 0.6em !important;
  border-left: 2px solid var(--tldrvi-accent, #2f9e7a) !important;
  color: inherit !important;
  opacity: 0.82;
  font-size: 0.95em !important;
  font-weight: inherit;
  font-style: normal !important;
  line-height: 1.55 !important;
  text-align: start !important;
  white-space: normal !important;
  background: none !important;
  grid-column: 1 / -1;
}
h1 > .tldrvi-tr, h2 > .tldrvi-tr, h3 > .tldrvi-tr { font-size: 0.8em !important; }
.tldrvi-tr.is-inline {
  display: inline !important;
  margin: 0 0 0 0.35em !important;
  padding: 0 !important;
  border: 0 !important;
  opacity: 0.75;
  font-size: 0.9em !important;
  line-height: inherit !important;
}
.tldrvi-tr.is-inline::before { content: "· "; opacity: 0.7; }`;

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
    badge: null,
    roots: new Set(), // document + các shadow root đã chèn style
    hostUnits: new Map(), // phần tử chứa → Set(đơn vị dịch)
    ownRemoved: new WeakSet(), // span do chính mình gỡ (để MutationObserver bỏ qua)
    added: new Set(),
    changed: new Set(),
    moTimer: null,
    theme: "default"
  };

  const isVietnamese = (t) => {
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (!letters) return false;
    return (t.match(VI_CHARS) || []).length / letters > 0.04;
  };
  const targetFor = (t) =>
    state.direction === "en2vi" ? "vi" : state.direction === "vi2en" ? "en" : isVietnamese(t) ? "en" : "vi";

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const textOf = (el) => clean(el.innerText);

  // ---------------- tìm đơn vị cần dịch ----------------
  // Đơn vị "el": khối lá (không có khối con) → span chèn cuối khối, trạng thái ở data-tldrvi.
  // Đơn vị "run": dãy chữ/phần tử inline nằm cạnh khối con (vd. <li>Mục cha<ul>…</ul></li>)
  //   → span chèn ngay sau node cuối của dãy, trạng thái giữ trong object.
  const isBlockDisplay = (d) => d === "block" || d === "flex" || d === "grid" || d === "list-item" || d === "table" || d === "flow-root";

  function hasBlockChild(el, display) {
    for (const c of el.children) {
      if (c.classList.contains("tldrvi-tr")) continue;
      if (BLOCK_TAGS.has(c.tagName)) return true;
      if (isBlockDisplay(display(c))) return true;
    }
    return false;
  }

  function isInlineNode(n, display) {
    if (n.nodeType === 3 || n.nodeType === 8) return true;
    if (n.nodeType !== 1 || n.classList.contains("tldrvi-tr")) return false;
    const d = display(n);
    return d.startsWith("inline") || d === "contents";
  }

  function stateOf(u) { return u.kind === "el" ? u.host.dataset.tldrvi : u.state; }
  function setState(u, s) {
    if (u.kind === "el") u.host.dataset.tldrvi = s;
    else u.state = s;
  }

  function addUnit(u) {
    let set = state.hostUnits.get(u.host);
    if (!set) state.hostUnits.set(u.host, (set = new Set()));
    set.add(u);
    state.io.observe(u.host); // đã quan sát thì không sao; đã bỏ quan sát thì quan sát lại
  }

  function dropUnit(u) {
    removeSpan(u);
    state.hostUnits.get(u.host)?.delete(u);
  }

  function removeSpan(u) {
    if (!u.span) return;
    state.ownRemoved.add(u.span);
    u.span.remove();
    u.span = null;
  }

  function directionOk(text) {
    if (state.direction === "en2vi" && isVietnamese(text)) return false;
    if (state.direction === "vi2en" && !isVietnamese(text)) return false;
    return true;
  }

  function addElementUnit(el) {
    if (el.dataset.tldrvi) return;
    const t = clean(el.textContent);
    if (!HAS_WORD.test(t) || !directionOk(t)) return;
    el.dataset.tldrvi = "pending";
    addUnit({ kind: "el", host: el, resets: 0, tries: 0 });
  }

  const runText = (u) => {
    const r = document.createRange();
    r.setStartBefore(u.first);
    r.setEndAfter(u.last);
    return clean(r.toString());
  };

  /** node nằm trong dãy anh em [a..b] */
  function inRun(node, a, b) {
    for (let x = a; x; x = x.nextSibling) {
      if (x === node) return true;
      if (x === b) return false;
    }
    return false;
  }

  function addRunUnit(block, textNode, display) {
    let c = textNode;
    while (c.parentNode !== block) c = c.parentNode;
    let first = c, last = c;
    while (first.previousSibling && isInlineNode(first.previousSibling, display)) first = first.previousSibling;
    while (last.nextSibling && isInlineNode(last.nextSibling, display)) last = last.nextSibling;
    const units = state.hostUnits.get(block);
    if (units) {
      for (const u of units) {
        if (u.kind !== "run") continue;
        if (u.first === first && u.last === last) return; // đã có
        // dãy cũ bị nới rộng (trang chèn thêm chữ) → bỏ đơn vị cũ, dịch lại cả dãy
        if (inRun(u.first, first, last) || inRun(u.last, first, last)) dropUnit(u);
      }
    }
    const u = { kind: "run", host: block, first, last, state: "pending", resets: 0, tries: 0 };
    const t = runText(u);
    if (!HAS_WORD.test(t) || !directionOk(t)) return;
    addUnit(u);
  }

  function ensureStyle(root) {
    if (state.roots.has(root)) return false;
    state.roots.add(root);
    const st = document.createElement("style");
    st.className = "tldrvi-style";
    st.textContent = TR_CSS;
    (root === document ? document.head || document.documentElement : root).appendChild(st);
    if (root !== document) state.mo.observe(root, MO_OPTS); // MutationObserver của document không thấy bên trong shadow root
    return true;
  }

  function scan(root = document.body) {
    if (!state.active || !root) return;
    if (root.nodeType === 1 && root.closest(SKIP_SEL)) return;
    const cache = new Map();
    const display = (el) => {
      let d = cache.get(el);
      if (d === undefined) cache.set(el, (d = getComputedStyle(el).display));
      return d;
    };
    const shadowHosts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.matches(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
          if (n.shadowRoot) shadowHosts.push(n);
          return NodeFilter.FILTER_SKIP;
        }
        return HAS_WORD.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      // khối gần nhất chứa chữ (a/label/b/thẻ tự định nghĩa hiển thị dạng khối cũng tính)
      let block = t.parentElement;
      if (!block) continue;
      while (block.parentElement && (display(block).startsWith("inline") || display(block) === "contents")) block = block.parentElement;
      if (block.dataset.tldrvi) continue;
      if (hasBlockChild(block, display)) addRunUnit(block, t, display);
      else addElementUnit(block);
    }
    for (const h of shadowHosts) {
      if (ensureStyle(h.shadowRoot)) scan(h.shadowRoot);
    }
    updateBadge();
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      state.io.unobserve(e.target);
      for (const u of state.hostUnits.get(e.target) || []) {
        if (stateOf(u) !== "pending" || state.queue.has(u)) continue;
        state.queue.add(u);
        state.total++;
      }
    }
    if (state.queue.size && !state.timer) state.timer = setTimeout(flush, 120);
    updateBadge();
  }

  // ---------------- chèn bản dịch ----------------
  function unitAlive(u) {
    if (u.kind === "el") return u.host.isConnected;
    return u.first.isConnected && u.last.isConnected && u.first.parentNode === u.host && u.last.parentNode === u.host;
  }

  /** Chữ gốc hiện tại của đơn vị (bỏ phần bản dịch đã chèn). */
  function sourceOf(u) {
    if (u.kind === "run") return runText(u);
    const full = textOf(u.host);
    if (!u.span?.isConnected) return full;
    const tr = clean(u.span.textContent);
    return full.endsWith(tr) ? full.slice(0, full.length - tr.length).trim() : full;
  }

  function useInline(u, text) {
    if (text.length <= 40 && text.split(" ").length <= 6 && !/[.?!:;。]$/.test(text)) return true;
    if (text.length > 80) return false;
    if (/flex|grid/.test(getComputedStyle(u.host).display)) return true;
    return Boolean(u.host.closest(INLINE_CTX));
  }

  function insertTranslation(u, translated, target) {
    if (!state.active || !unitAlive(u)) return;
    removeSpan(u);
    const span = document.createElement("span");
    span.className = "tldrvi-tr" + (useInline(u, u.src) ? " is-inline" : "");
    span.lang = target;
    span.textContent = translated;
    if (u.kind === "el") u.host.appendChild(span);
    else u.last.after(span);
    u.span = span;
    setState(u, "done");
  }

  function scheduleRetry(u) {
    if (u.tries >= 1) return;
    u.tries++;
    setTimeout(() => {
      if (!state.active || !unitAlive(u) || stateOf(u) !== "error") return;
      state.failed--;
      state.done--;
      setState(u, "pending");
      state.queue.add(u);
      if (!state.timer) state.timer = setTimeout(flush, 120);
    }, RETRY_MS);
  }

  async function flush() {
    state.timer = null;
    const items = [...state.queue];
    state.queue.clear();
    if (!items.length || !state.active) return;

    // nhóm theo ngôn ngữ đích
    const groups = { vi: [], en: [] };
    for (const u of items) {
      if (!unitAlive(u)) { state.total--; dropUnit(u); continue; }
      const text = sourceOf(u).slice(0, MAX_LEN);
      if (!HAS_WORD.test(text)) { setState(u, "same"); state.done++; continue; }
      const target = targetFor(text);
      const key = target + "|" + text;
      u.src = text;
      if (state.cache.has(key)) {
        insertTranslation(u, state.cache.get(key), target);
        state.done++;
        continue;
      }
      setState(u, "loading");
      groups[target].push({ u, text, key });
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
        let failed = 0;
        part.forEach((x, j) => {
          const tr = res?.ok ? res.translations[j] : null;
          if (tr && tr.trim() && tr.trim() !== x.text) {
            state.cache.set(x.key, tr);
            insertTranslation(x.u, tr, target);
          } else {
            setState(x.u, tr ? "same" : "error");
            if (!tr) { state.failed++; failed++; scheduleRetry(x.u); }
          }
          state.done++;
        });
        if (!res?.ok) setBadgeError(res?.error || "Lỗi dịch");
        else if (failed) setBadgeError(`${failed} đoạn chưa dịch được, sẽ thử lại`);
        else clearBadgeError();
        updateBadge();
      }
    }
  }

  // ---------------- trang tự thay đổi (tải thêm, SPA render lại) ----------------
  const isOurs = (n) => {
    const el = n.nodeType === 1 ? n : n.parentElement;
    return Boolean(el?.closest(OURS_SEL)) || Boolean(el?.classList.contains("tldrvi-style"));
  };

  function onMutations(muts) {
    for (const m of muts) {
      if (isOurs(m.target)) continue;
      if (m.type === "characterData") {
        if (m.target.parentElement) state.changed.add(m.target.parentElement);
        continue;
      }
      let touched = false;
      for (const n of m.removedNodes) {
        if (state.ownRemoved.has(n)) continue;
        touched = true; // kể cả khi trang gỡ span bản dịch của mình
      }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.matches(OURS_SEL) || n.classList.contains("tldrvi-style"))) continue;
        if (n.nodeType === 1) state.added.add(n);
        else if (n.nodeType === 3) state.added.add(m.target);
        touched = true;
      }
      if (touched && m.target.nodeType === 1) state.changed.add(m.target);
    }
    if (!state.added.size && !state.changed.size) return;
    clearTimeout(state.moTimer);
    state.moTimer = setTimeout(processMutations, 500);
  }

  /**
   * Đơn vị đã xử lý mà chữ gốc đổi hoặc bị gỡ bản dịch → dịch lại.
   * Trả về true nếu cần quét lại phần tử chứa (dãy chữ cũ không còn nguyên vẹn).
   */
  function recheck(u) {
    const st = stateOf(u);
    if (st === "pending" || st === "loading") return false;
    if (!unitAlive(u)) {
      dropUnit(u);
      return u.kind === "run" && u.host.isConnected;
    }
    const lost = st === "done" && !u.span?.isConnected;
    if (!lost && sourceOf(u) === u.src) return false;
    if (u.resets >= MAX_RESETS) return false;
    u.resets++;
    removeSpan(u);
    if (u.kind === "el" && !HAS_WORD.test(sourceOf(u))) {
      // hết chữ (vd. trang xoá nội dung) → bỏ hẳn, lần quét sau sẽ nhận lại nếu có chữ mới
      delete u.host.dataset.tldrvi;
      dropUnit(u);
      return false;
    }
    if (st === "error") state.failed--;
    state.done--;
    state.total--;
    setState(u, "pending");
    state.io.unobserve(u.host);
    state.io.observe(u.host); // quan sát lại → IntersectionObserver báo ngay nếu đang trên màn hình
    return false;
  }

  function processMutations() {
    if (!state.active) return;
    const changed = [...state.changed];
    const added = [...state.added];
    state.changed.clear();
    state.added.clear();
    for (const el of changed) {
      // đơn vị chứa chữ vừa đổi: của chính el hoặc của khối gần nhất phía trên
      for (let x = el; x; x = x.parentElement) {
        const units = state.hostUnits.get(x);
        if (!units?.size) continue;
        let rescan = false;
        for (const u of [...units]) rescan = recheck(u) || rescan;
        if (rescan) added.push(x);
        break;
      }
    }
    for (const n of new Set(added)) if (n.isConnected) scan(n);
    for (const [host, units] of state.hostUnits) if (!units.size || !host.isConnected) state.hostUnits.delete(host);
  }

  // ---------------- badge trạng thái ----------------
  function ensureBadge() {
    if (state.badge?.isConnected) return state.badge;
    const b = document.createElement("div");
    b.className = "tldrvi-badge";
    if (state.theme) b.dataset.theme = state.theme;
    b.innerHTML = `<span class="tldrvi-badge-dot"></span><span class="tldrvi-badge-text"></span><button type="button" title="Tắt dịch song ngữ">Tắt</button>`;
    b.querySelector("button").addEventListener("click", () => toggle(false));
    document.documentElement.appendChild(b);
    state.badge = b;
    return b;
  }
  function updateBadge() {
    if (!state.active) return;
    const b = ensureBadge();
    const label = state.direction === "en2vi" ? "Anh → Việt" : state.direction === "vi2en" ? "Việt → Anh" : "Anh ⇄ Việt";
    b.querySelector(".tldrvi-badge-text").textContent =
      `Song ngữ ${label} · ${state.done}/${state.total}` + (state.failed ? ` · lỗi ${state.failed}` : "");
    b.classList.toggle("is-busy", state.inflight > 0 || state.queue.size > 0);
    if (!b.classList.contains("is-error")) b.title = "Phần còn lại sẽ được dịch khi bạn cuộn tới";
  }
  function setBadgeError(msg) {
    const b = ensureBadge();
    b.classList.add("is-error");
    b.title = msg;
  }
  function clearBadgeError() {
    if (!state.failed) state.badge?.classList.remove("is-error");
  }

  // ---------------- bật / tắt ----------------
  function start(direction) {
    state.active = true;
    state.direction = direction || "auto";
    state.done = state.total = state.failed = 0;
    state.io = new IntersectionObserver(onIntersect, { rootMargin: "600px 0px" });
    state.mo = new MutationObserver(onMutations);
    ensureStyle(document);
    state.mo.observe(document.body, MO_OPTS);
    scan();
  }

  function stop() {
    state.active = false;
    state.io?.disconnect();
    state.mo?.disconnect();
    clearTimeout(state.timer);
    clearTimeout(state.moTimer);
    state.timer = null;
    state.queue.clear();
    state.added.clear();
    state.changed.clear();
    for (const root of state.roots) {
      root.querySelectorAll(".tldrvi-tr, .tldrvi-style").forEach((n) => n.remove());
      root.querySelectorAll("[data-tldrvi]").forEach((n) => delete n.dataset.tldrvi);
    }
    state.roots.clear();
    state.hostUnits.clear();
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
  // Điểm để neo popup (toạ độ viewport): chỗ chuột vừa thả khi bôi đen (fab.js ghi vào __tldrviPointer,
  // cùng isolated world) nếu nó nằm sát vùng chọn; không thì cuối vùng chọn; không có gì thì giữa màn hình.
  function popupAnchor() {
    const sel = getSelection();
    const rects = sel && sel.rangeCount ? [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width || r.height) : [];
    const p = window.__tldrviPointer;
    const near = (r) => p.x >= r.left - 40 && p.x <= r.right + 40 && p.y >= r.top - 40 && p.y <= r.bottom + 40;
    if (p && rects.some(near)) return { x: p.x, y: p.y };
    const last = rects[rects.length - 1];
    if (last) return { x: Math.min(Math.max(0, last.right), window.innerWidth), y: Math.min(Math.max(0, last.top), window.innerHeight) };
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  // Đặt popup ngay phía trên điểm neo (đủ chỗ thì lên trên, không thì xuống dưới; thiếu cả hai thì co chiều cao).
  // Neo bằng toạ độ trang nên popup cuộn theo nội dung; gọi lại khi chữ dịch về làm popup đổi chiều cao.
  function placePopup(pop, anchor) {
    const GAP = 12, EDGE = 8;
    const ax = anchor.x - window.scrollX, ay = anchor.y - window.scrollY;
    pop.style.maxHeight = "";
    const w = pop.offsetWidth;
    let h = pop.offsetHeight;
    const above = ay - GAP - EDGE, below = window.innerHeight - ay - GAP - EDGE;
    const up = h <= above || (h > below && above >= below);
    const room = up ? above : below;
    if (h > room) {
      pop.style.maxHeight = Math.max(80, room) + "px";
      h = pop.offsetHeight;
    }
    const top = up ? ay - GAP - h : ay + GAP;
    const left = Math.min(Math.max(EDGE, ax - w / 2), Math.max(EDGE, window.innerWidth - w - EDGE));
    pop.style.top = window.scrollY + Math.max(EDGE, top) + "px";
    pop.style.left = window.scrollX + left + "px";
  }

  async function showSelection(text) {
    text = (text || String(getSelection() || "")).trim().slice(0, MAX_LEN);
    if (!text) return;
    document.querySelector(".tldrvi-pop")?.remove();
    const target = isVietnamese(text) ? "en" : "vi";
    const pop = document.createElement("div");
    pop.className = "tldrvi-pop";
    if (state.theme) pop.dataset.theme = state.theme;
    pop.innerHTML = `<div class="tldrvi-pop-head"><span>${target === "vi" ? "Anh → Việt" : "Việt → Anh"}</span><span class="tldrvi-pop-actions"><button type="button" data-a="copy">Sao chép</button><button type="button" data-a="close" aria-label="Đóng">✕</button></span></div><div class="tldrvi-pop-body">Đang dịch…</div>`;
    const a = popupAnchor();
    const anchor = { x: a.x + window.scrollX, y: a.y + window.scrollY };
    document.documentElement.appendChild(pop);
    placePopup(pop, anchor);
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
    if (pop.isConnected) placePopup(pop, anchor); // chữ dịch làm popup cao lên → giữ nó sát điểm neo
  }

  function getActiveTheme() {
    const fromDoc = document.documentElement.dataset.tldrviTheme || document.documentElement.dataset.theme;
    if (fromDoc) return fromDoc;
    const fabHost = document.getElementById("tldrvi-fab-host");
    const fromFab = fabHost?.shadowRoot?.querySelector(".root")?.dataset?.theme;
    if (fromFab) return fromFab;
    return "default";
  }

  function applyTheme(theme) {
    state.theme = theme === "pink" ? "pink" : "default";
    document.documentElement.dataset.tldrviTheme = state.theme;
    for (const pop of document.querySelectorAll(".tldrvi-pop")) pop.dataset.theme = state.theme;
    if (state.badge) state.badge.dataset.theme = state.theme;
  }

  applyTheme(getActiveTheme());
  try {
    chrome.storage?.local?.get("settings").then(({ settings }) => {
      if (settings?.theme) applyTheme(settings.theme);
    }).catch(() => {});
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.settings?.newValue?.theme) {
        applyTheme(changes.settings.newValue.theme);
      }
    });
  } catch {}

  window.__tldrvi = {
    toggle,
    stop,
    showSelection,
    alive() {
      try { return Boolean(chrome.runtime?.id); } catch { return false; }
    },
    get active() { return state.active; },
    get direction() { return state.direction; }
  };
})();
