// Phía giao diện (popup, side panel) của kênh "summarize" với background: nhận chữ đang stream rồi kết quả cuối.

/**
 * @param {{tabId:number, force?:boolean, onPartial?:(result:object)=>void}} opts
 * @returns {Promise<{result:object, cached:boolean}>}
 */
export function streamSummary({ tabId, force = false, onPartial }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "summarize" });
    let settled = false;
    const finish = (fn, value) => {
      settled = true;
      port.disconnect();
      fn(value);
    };
    port.onMessage.addListener((m) => {
      if (m.type === "partial") onPartial?.(m.result);
      else if (m.type === "done") finish(resolve, { result: m.result, cached: m.cached });
      else if (m.type === "error") finish(reject, new Error(m.error || "Có lỗi xảy ra."));
    });
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error("Mất kết nối với extension – hãy thử lại."));
    });
    port.postMessage({ tabId, force });
  });
}

// Gộp nhiều lần cập nhật trong cùng một khung hình thành một lần vẽ
export function frameThrottle(fn) {
  let pending = null;
  return (arg) => {
    const first = pending === null;
    pending = arg;
    if (first) {
      requestAnimationFrame(() => {
        const a = pending;
        pending = null;
        fn(a);
      });
    }
  };
}
