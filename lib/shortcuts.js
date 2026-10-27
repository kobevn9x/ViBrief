// Phím tắt đang gán thật (người dùng có thể đổi, hoặc Chrome không gán vì trùng với extension khác).

export const SHORTCUT_LABELS = {
  _execute_action: "Mở popup tóm tắt nhanh",
  "toggle-bilingual": "Bật/tắt dịch song ngữ"
};

/** { tên lệnh: "Alt+S" | "" (chưa gán) } */
export async function getShortcuts() {
  const out = {};
  try {
    for (const c of await chrome.commands.getAll()) out[c.name] = c.shortcut || "";
  } catch { /* ignore */ }
  return out;
}

/** "Alt+S" → <kbd>Alt</kbd>+<kbd>S</kbd> (DOM, không dùng innerHTML) */
export function shortcutNodes(shortcut) {
  const nodes = [];
  shortcut.split("+").forEach((k, i) => {
    if (i) nodes.push(document.createTextNode("+"));
    nodes.push(Object.assign(document.createElement("kbd"), { textContent: k }));
  });
  return nodes;
}

export function openShortcutsPage() {
  return chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
}
