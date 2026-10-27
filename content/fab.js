// Nút nổi "Tóm tắt trang này" (content script khai báo trong manifest).
// Không đọc nội dung trang: chỉ dựng giao diện trong shadow DOM; việc tóm tắt do background làm.
(() => {
  if (window.__tldrviFab) return;
  window.__tldrviFab = true;

  const TITLE = "Tóm tắt trang này (ViBrief)";
  const MSG_RELOAD = "Extension vừa được cập nhật – hãy tải lại trang.";
  const MSG_PANEL_HINT = "Nhấn Alt+S rồi bấm “Mở bảng đầy đủ”.";
  // icons/icon48.png dạng data URI (giữ đồng bộ nếu đổi icon)
  const ICON_48 = "data:image/png;base64,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";

  const CSS = `
:host { all: initial; }
.root {
  --bg: #f7f9f8;
  --surface: #ffffff;
  --border: #dfe7e3;
  --text: #17201c;
  --muted: #5d6b65;
  --accent: #23845f;
  --accent-ink: #ffffff;
  --accent-soft: #e4f3ec;
  --mark: #fff1b8;
  --danger: #c2412f;
  color-scheme: light dark;
  font: 14px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #111715;
    --surface: #18201d;
    --border: #2a3530;
    --text: #e5eeea;
    --muted: #93a39c;
    --accent: #3fbf8c;
    --accent-ink: #08130e;
    --accent-soft: #1d3329;
    --mark: #4a4220;
    --danger: #ff806e;
  }
}
/* "Trắng hồng dịu" – luôn sáng, kể cả khi hệ thống ở chế độ tối */
.root[data-theme="pink"] {
  --bg: #fff7fa;
  --surface: #ffffff;
  --border: #f5d3e0;
  --text: #3b2a31;
  --muted: #775966;
  --accent: #b23c6b;
  --accent-ink: #ffffff;
  --accent-soft: #fde7f0;
  --mark: #ffd6e5;
  --danger: #c2412f;
  color-scheme: light;
}
.root[hidden], [hidden] { display: none !important; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }

/* Nút tab bám mép phải, giữa màn hình (không đè badge song ngữ ở góc dưới) */
.fab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  z-index: 2147483647;
  width: 44px; height: 44px; padding: 0 0 0 4px; margin: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface); border: 1px solid var(--border); border-right: 0;
  border-radius: 22px 0 0 22px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
  cursor: pointer; opacity: .88;
  transition: opacity .15s, width .15s, box-shadow .15s;
}
.fab:hover, .fab:focus-visible, .fab[aria-expanded="true"] { opacity: 1; width: 50px; box-shadow: 0 6px 20px rgba(0, 0, 0, .24); }
.fab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fab img { width: 26px; height: 26px; display: block; pointer-events: none; }

.card {
  position: fixed; right: 56px; top: 50%; transform: translateY(-50%);
  z-index: 2147483647;
  width: 360px; max-width: calc(100vw - 72px); max-height: 70vh;
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, .22);
  overflow: hidden;
}
.card-head {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 9px 10px 9px 14px; background: var(--surface); border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: .2px; flex: 1; }
.brand img { width: 18px; height: 18px; }
.close {
  all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 14px;
}
.close:hover { background: var(--accent-soft); color: var(--text); }
.close:focus-visible { outline: 2px solid var(--accent); }

.card-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; }
.card-foot {
  flex: none; display: flex; flex-direction: column; gap: 6px;
  padding: 10px 14px 12px; background: var(--surface); border-top: 1px solid var(--border);
}
.hint { margin: 0; font-size: 12px; color: var(--muted); text-align: center; }

.btn { font: inherit; font-weight: 600; border-radius: 8px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; }
.btn.primary { background: var(--accent); color: var(--accent-ink); }
.btn.primary:hover { filter: brightness(1.06); }
.btn.block { width: 100%; }

.status { font-size: 13px; padding: 9px 11px; border-radius: 8px; background: var(--accent-soft); }
.status.error { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.status.loading::before {
  content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 8px; vertical-align: -1px;
  border: 2px solid var(--accent); border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.result {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
}
h3 { margin: 6px 0 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
.tldr { margin: 0; font-weight: 600; font-size: 15px; padding-left: 10px; border-left: 3px solid var(--accent); }
.bullets { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.para { margin: 0; }
.note { margin: 0; font-size: 12px; color: var(--muted); }
mark { background: var(--mark); color: inherit; padding: 0 2px; border-radius: 3px; }
.alt { display: block; margin-top: 2px; font-size: .92em; color: var(--muted); }
.tldr .alt { font-weight: 400; }
/* con trỏ nhấp nháy sau chữ đang stream */
.streaming > .tldr:last-child::after,
.streaming > .bullets:last-child > li:last-child::after,
.streaming > .para:last-child::after {
  content: ""; display: inline-block; width: .45em; height: 1em; margin-left: 2px; vertical-align: -.15em;
  background: var(--accent); border-radius: 1px; animation: caret 1s steps(1) infinite;
}
@keyframes caret { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .streaming *::after { animation: none !important; } }

@media print { .root { display: none !important; } }
`;

  // Trả về true nếu lỗi do extension vừa được nạp lại (context cũ không còn dùng được)
  const isInvalidated = (e) => /Extension context invalidated/i.test(String(e?.message || e));
  const alive = () => Boolean(globalThis.chrome?.runtime?.id);

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k in n && typeof v !== "string") n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c);
    return n;
  }

  try {
    if (!(document.documentElement instanceof HTMLHtmlElement)) return;
    if (document.contentType === "application/pdf") return;
    if (document.getElementById("tldrvi-fab-host")) return;

    const host = document.createElement("div");
    host.id = "tldrvi-fab-host";
    host.setAttribute("style", "all: initial !important;");
    const shadow = host.attachShadow({ mode: "open" });

    // icon nhúng sẵn (data URI) thay vì chrome.runtime.getURL: không cần web_accessible_resources,
    // nên trang web không dò được extension đã cài qua chrome-extension://<id>/icons/…
    const iconURL = ICON_48;

    const fab = el("button", { class: "fab", type: "button", title: TITLE, "aria-label": TITLE, "aria-expanded": "false" }, [
      el("img", { src: iconURL, alt: "" })
    ]);
    const closeBtn = el("button", { class: "close", type: "button", title: "Đóng", "aria-label": "Đóng", text: "✕" });
    const body = el("div", { class: "card-body", "aria-live": "polite" });
    const openBtn = el("button", { class: "btn primary block", type: "button", text: "Mở bảng đầy đủ" });
    const hint = el("p", { class: "hint", hidden: true });
    const card = el("section", { class: "card", role: "dialog", "aria-label": "ViBrief", hidden: true }, [
      el("header", { class: "card-head" }, [
        el("span", { class: "brand" }, [el("img", { src: iconURL, alt: "" }), "ViBrief"]),
        closeBtn
      ]),
      body,
      el("footer", { class: "card-foot" }, [openBtn, hint])
    ]);
    const root = el("div", { class: "root", "data-theme": "default", hidden: true }, [fab, card]);

    shadow.append(el("style", { text: CSS }), root);
    document.documentElement.append(host);

    // ------------------------------------------------------------ trạng thái
    let result = null; // { url, html } – kết quả gần nhất (dùng lại khi mở lại trên cùng URL)
    let pendingURL = null; // URL đang được tóm tắt
    let partialHTML = null; // chữ đang stream của lượt hiện tại
    let frame = 0;

    function showStatus(text, kind) {
      body.replaceChildren(el("div", { class: `status ${kind || ""}`.trim(), text }));
    }
    // html: chuỗi đã được renderSummaryHTML escape ở background
    function showResult(html, streaming = false) {
      let box = body.firstElementChild;
      if (!box?.classList.contains("result")) {
        box = el("div", { class: "result" });
        body.replaceChildren(box);
        body.scrollTop = 0;
      }
      box.innerHTML = html;
      box.classList.toggle("streaming", streaming);
    }

    // Tóm tắt qua kênh "summarize": background gửi chữ dần (partial) rồi kết quả cuối (done)
    function summarize() {
      const url = location.href;
      pendingURL = url;
      partialHTML = null;
      showStatus("Đang đọc trang…", "loading");
      const fail = (error) => {
        if (pendingURL !== url) return;
        pendingURL = null;
        showStatus(error, "error");
      };
      let port;
      try {
        if (!alive()) throw new Error("Extension context invalidated.");
        port = chrome.runtime.connect({ name: "summarize" });
      } catch (e) {
        fail(isInvalidated(e) || !alive() ? MSG_RELOAD : e?.message || String(e));
        return;
      }
      let settled = false;
      port.onMessage.addListener((m) => {
        if (pendingURL !== url) return; // đã chuyển trang (SPA) trong lúc chờ
        if (m.type === "partial" && typeof m.html === "string") {
          partialHTML = m.html;
          if (!frame) {
            frame = requestAnimationFrame(() => {
              frame = 0;
              if (pendingURL === url && partialHTML && !card.hidden) showResult(partialHTML, true);
            });
          }
          return;
        }
        settled = true;
        port.disconnect();
        if (m.type === "done" && typeof m.html === "string") {
          pendingURL = null;
          partialHTML = null;
          result = { url, html: m.html };
          if (location.href === url) showResult(m.html);
        } else {
          fail(m.error || "Có lỗi xảy ra.");
        }
      });
      port.onDisconnect.addListener(() => {
        if (!settled) fail(alive() ? "Mất kết nối với extension – hãy thử lại." : MSG_RELOAD);
      });
      port.postMessage({});
    }

    function openCard() {
      card.hidden = false;
      fab.setAttribute("aria-expanded", "true");
      hint.hidden = true;
      const url = location.href;
      if (result?.url === url) showResult(result.html);
      else if (pendingURL === url) {
        if (partialHTML) showResult(partialHTML, true);
        else showStatus("Đang đọc trang…", "loading");
      } else summarize();
    }
    function closeCard() {
      card.hidden = true;
      fab.setAttribute("aria-expanded", "false");
    }

    // Chỉ nhận cú bấm thật của người dùng: script của trang có thể lấy shadowRoot và gọi .click(),
    // việc đó không được phép kích hoạt tóm tắt (tốn quota/tiền API key của người dùng).
    fab.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      card.hidden ? openCard() : closeCard();
    });
    closeBtn.addEventListener("click", () => {
      closeCard();
      fab.focus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !card.hidden) closeCard();
    }, true);

    openBtn.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      hint.hidden = true;
      let res;
      try {
        if (!alive()) throw new Error("Extension context invalidated.");
        res = await chrome.runtime.sendMessage({ type: "open-panel" });
      } catch (e) {
        if (isInvalidated(e) || !alive()) {
          showStatus(MSG_RELOAD, "error");
          return;
        }
        res = null;
      }
      if (res?.ok) closeCard();
      else {
        hint.textContent = MSG_PANEL_HINT;
        hint.hidden = false;
      }
    });

    // ------------------------------------------------------------ giao diện + bật/tắt nút
    function applySettings(settings) {
      root.dataset.theme = settings?.theme === "pink" ? "pink" : "default";
      root.hidden = settings?.showFab === false;
      if (root.hidden) closeCard();
    }

    chrome.storage.local
      .get("settings")
      .then(({ settings }) => applySettings(settings))
      .catch(() => applySettings(null));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) applySettings(changes.settings.newValue);
    });
  } catch {
    // attachShadow/chrome.* không dùng được trên trang này – bỏ qua, không hiện nút
  }
})();
