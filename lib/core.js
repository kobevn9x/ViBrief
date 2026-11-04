// Phần thuần (không DOM, không chrome.*) dùng chung cho content script, service worker, side panel và test.
// Script cổ điển (không phải module): content script nạp bằng manifest/executeScript `files`,
// còn lib/translate.js `import "./core.js"` rồi đọc globalThis.__tldrviCore.
// Luôn gán lại (không chặn nạp trùng) để mã mới thắng khi inject lại; dùng globalThis, không dùng this/window.
(() => {
  const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;
  const MIN_SELECTION = 100; // đoạn bôi đen dài hơn ngần này ký tự mới tóm tắt riêng
  const MAX_LEN = 4500; // đoạn chọn/đơn vị dịch bị cắt ở độ dài này

  /** Ước lượng đoạn văn có phải tiếng Việt không (theo tỉ lệ ký tự có dấu đặc trưng). */
  function isVietnamese(text) {
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (!letters) return false;
    return (text.match(VI_CHARS) || []).length / letters > 0.04;
  }

  /** Ngôn ngữ đích cho 1 đoạn theo hướng dịch đã chọn. */
  function targetFor(text, direction) {
    if (direction === "en2vi") return "vi";
    if (direction === "vi2en") return "en";
    return isVietnamese(text) ? "en" : "vi";
  }

  /**
   * Vị trí thẻ tóm tắt cạnh vùng chọn (toạ độ viewport). anchor: hình chữ nhật dòng cuối của đoạn chọn.
   * null = không đủ chỗ cả hai phía (giữ vị trí mặc định cạnh nút nổi);
   * ngược lại {left, top, bottom, maxHeight}: đặt dưới thì `bottom` null, đặt trên thì `top` null.
   */
  function cardPlacement(anchor, vw, vh) {
    if (!anchor) return null;
    const below = vh - anchor.bottom - 16, above = anchor.top - 16;
    if (Math.max(below, above) < 200) return null;
    const w = Math.min(360, vw - 16);
    const left = Math.min(Math.max(8, anchor.left), vw - w - 8);
    if (below >= 200 || below >= above) return { left, top: anchor.bottom + 8, bottom: null, maxHeight: Math.min(below, vh * 0.7) };
    return { left, top: null, bottom: vh - anchor.top + 8, maxHeight: Math.min(above, vh * 0.7) };
  }

  /**
   * Điểm neo popup dịch (toạ độ viewport): chỗ chuột vừa thả nếu nằm sát một rect của vùng chọn;
   * không thì cuối rect cuối (kẹp trong màn hình); không có rect thì giữa màn hình.
   */
  function anchorFrom(rects, pointer, vw, vh) {
    const near = (r) => pointer.x >= r.left - 40 && pointer.x <= r.right + 40 && pointer.y >= r.top - 40 && pointer.y <= r.bottom + 40;
    if (pointer && rects.some(near)) return { x: pointer.x, y: pointer.y };
    const last = rects[rects.length - 1];
    if (last) return { x: Math.min(Math.max(0, last.right), vw), y: Math.min(Math.max(0, last.top), vh) };
    return { x: vw / 2, y: vh / 2 };
  }

  /** Thứ tự gửi dịch: đang nhìn thấy (trên xuống) < phía dưới (sắp cuộn tới) < phía trên. Số nhỏ gửi trước. */
  function rankOf(top, bottom, vh) {
    return bottom >= 0 && top < vh ? top : top >= vh ? 1e6 + top : 2e6 - top;
  }

  const core = { VI_CHARS, MIN_SELECTION, MAX_LEN, isVietnamese, targetFor, cardPlacement, anchorFrom, rankOf };
  globalThis.__tldrviCore = core;
  if (typeof module === "object" && module && module.exports) module.exports = core;
})();
