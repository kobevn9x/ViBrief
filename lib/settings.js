// Cài đặt mặc định + đọc/ghi chrome.storage.local
export const DEFAULTS = {
  provider: "openrouter", // openrouter | openai | anthropic | gemini | compat
  apiKeys: { openrouter: "", openai: "", anthropic: "", gemini: "", compat: "" },
  models: {
    openrouter: "", // để trống = tự chọn model miễn phí lúc chạy
    openai: "gpt-6-luna",
    anthropic: "claude-haiku-5-5",
    gemini: "gemini-3.6-flash",
    compat: "llama3.1"
  },
  compatBaseUrl: "http://localhost:11434/v1",
  summaryLang: "bi", // bi (song ngữ Việt + Anh) | vi | en | auto (theo ngôn ngữ trang)
  summaryLength: "medium", // short | medium | long
  autoSummarize: false,
  translateEngine: "google", // google (miễn phí) | llm
  translateDirection: "auto", // auto | en2vi | vi2en
  theme: "default", // default | pink
  showFab: true // hiện nút tóm tắt nổi trên trang
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = structuredClone(DEFAULTS);
  if (settings) {
    Object.assign(s, settings);
    s.apiKeys = { ...DEFAULTS.apiKeys, ...(settings.apiKeys || {}) };
    s.models = { ...DEFAULTS.models, ...(settings.models || {}) };
  }
  return s;
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  if (patch.apiKeys) next.apiKeys = { ...cur.apiKeys, ...patch.apiKeys };
  if (patch.models) next.models = { ...cur.models, ...patch.models };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function hasLLMKey(s) {
  if (s.provider === "compat") return Boolean(s.compatBaseUrl);
  return Boolean(s.apiKeys[s.provider]);
}

export const PROVIDER_LABELS = {
  openrouter: "OpenRouter (model miễn phí)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
  compat: "OpenAI-compatible (Ollama, LM Studio…)"
};
