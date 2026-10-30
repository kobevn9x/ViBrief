# Lan Brieft – Summarize & Translate English ⇄ Vietnamese

[Tiếng Việt](README.md) · **English**

A Chrome extension (Manifest V3) inspired by *TLDR Summarizer AI*, with 3 features:

1. **Summarize the current page**: a one-sentence TL;DR + 3/5/8 key points (with highlighted keywords) + a summary paragraph. By default the summary is **bilingual English–Vietnamese** (each Vietnamese sentence is followed by its English version); you can also choose Vietnamese only, English only, or the page's language, and the length. View it quickly in the popup when you click the icon, or in the full Side Panel.
2. **Bilingual English ⇄ Vietnamese translation right on the page**: the translation is inserted under each paragraph (Immersive Translate style), the direction is detected per paragraph, and only the parts you are about to scroll to are translated to save quota. Also translates highlighted text (right-click) and has a quick-translate box in the panel.
3. **Chat about the page**: ask the AI about the page after summarizing it, to get more detail, or draft a **reply email** when the page is an email (the **Hỏi đáp** tab in the Side Panel).

The extension's interface is in Vietnamese. In this guide, UI labels are shown as they appear, followed by an English translation in parentheses the first time.

## Screenshots

### Summarize right on the page

Click the **floating button** on the right edge of the screen: a bilingual summary card appears next to it, with each Vietnamese sentence followed by the English version and keywords highlighted.

![Bilingual summary card next to the floating button](docs/images/fab-card.png)

### Quick-summary popup and Side Panel

Click the toolbar icon (or press `Alt+S`) to see the summary in the popup; **Mở bảng đầy đủ** (*Open full panel*) opens the Side Panel with 4 tabs: Tóm tắt (*Summary*) · Dịch (*Translate*) · Hỏi đáp (*Q&A*) · Cài đặt (*Settings*).

<p>
  <img src="docs/images/popup.png" width="300" alt="Quick-summary popup">
  &nbsp;
  <img src="docs/images/sidepanel-summary.png" width="300" alt="Summary tab in the Side Panel">
</p>

### Bilingual translation on the page

The Vietnamese translation is inserted under each paragraph; short text in menus is translated on the same line so the layout doesn't break. The badge at the bottom right shows progress and has a **Tắt** (*Off*) button.

![English page with the Vietnamese translation under each paragraph](docs/images/bilingual.png)

### Summarize or translate highlighted text

Highlight more than 100 characters: two buttons, **Tóm tắt đoạn này** (*Summarize this*) and **Dịch đoạn này** (*Translate this*), appear right below the selection. Translating opens a popup above the point where you released the mouse, with a **Sao chép** (*Copy*) button.

![The Summarize this and Translate this buttons below a highlighted paragraph](docs/images/selection-bar.png)

![Translation popup for the highlighted paragraph](docs/images/selection-translate.png)

### Chat about the page

The **Hỏi đáp** tab: ask more about the page or draft a reply email. The AI reads the page itself, so it can answer details that are not in the summary.

<img src="docs/images/chat.png" width="300" alt="Q&A tab in the Side Panel">

### Settings and themes

Choose the AI provider, enter the API key and pick a model. Two themes: *Mặc định (xanh lá)* (*Default, green*) and *Trắng hồng dịu* (*Soft pink*).

<p>
  <img src="docs/images/settings.png" width="300" alt="Settings tab">
  &nbsp;
  <img src="docs/images/theme-pink.png" width="300" alt="Soft pink theme">
</p>

## Installation (developer mode)

1. Go to [**Releases**](https://github.com/kobevn9x/ViBrief/releases), download `vibrief-x.y.z.zip` from the latest release and unzip it (or click **Code → Download ZIP** on the main page).
2. Open `chrome://extensions` → turn on **Developer mode** (top right).
3. Click **Load unpacked** → select the folder you just unzipped.
4. Pin the Lan Brieft icon to the toolbar.
5. Get a **free** API key at <https://openrouter.ai/keys> (requires an OpenRouter account).
6. Open the Side Panel (click the icon or press `Alt+S` → **Mở bảng đầy đủ**) → **Cài đặt** tab → the default provider is **OpenRouter (free models)**; paste the API key → **Lưu** (*Save*) → **Kiểm tra kết nối** (*Test connection*).

Translation with Google needs no key: it works right after installation.

**Updating to a new version:** download the new zip from Releases, unzip it over the old folder, then click the reload button (⟳) on the Lan Brieft card in `chrome://extensions`. Your saved settings and API key are kept.

## How to use

| Task | How |
|---|---|
| Summarize right on the page | Click the **floating button** in the middle of the right edge → a bilingual summary card appears next to it (✕ or `Esc` to close) |
| Quick summary | Click the toolbar icon or press `Alt+S` → the popup shows a summary of the current page |
| Open the full panel | In the popup, click **Mở bảng đầy đủ** → opens the Side Panel (Tóm tắt · Dịch · Hỏi đáp · Cài đặt) |
| Summarize in the Side Panel | Right-click → *Tóm tắt trang này* (*Summarize this page*), or **Tóm tắt trang này** in the panel |
| Summarize highlighted text | Highlight more than 100 characters → click the **Tóm tắt đoạn này** button next to the selection (or right-click → *Tóm tắt đoạn đã chọn*, *Summarize selection*) |
| Translate highlighted text | The **Dịch đoạn này** button sits in the same place (English ⇄ Vietnamese popup with a Copy button); for shorter text, right-click → *Dịch đoạn đã chọn* (*Translate selection*) |
| Ask more about the page | **Hỏi đáp** tab → type a question (`Enter` to send); or click **Hỏi thêm** (*Ask more*) under the summary. The ✉️ **Viết phản hồi** (*Write a reply*) chip is always available (emails, Freshdesk/Zendesk tickets, messages…) |
| Turn bilingual mode on/off | **Dịch** tab → toggle, or `Alt+T`, or right-click → *Dịch song ngữ trang này* (*Translate this page bilingually*); turn it off with the **Tắt** button on the badge at the bottom right |
| Translate a selection | Highlight → right-click → *Dịch đoạn đã chọn* (floating popup with a Copy button) |
| Quick translate | **Dịch** tab → paste text → **Dịch** (`Ctrl+Enter`) |

The active shortcuts are shown at the bottom of the popup and in **Cài đặt** → **Phím tắt** (*Shortcuts*); they read *Chưa gán* (*Not assigned*) if Chrome could not assign them, usually because another extension uses the same keys. Click **Đổi phím tắt** (*Change shortcuts*), or open `chrome://extensions/shortcuts`, to set them again.

### Bilingual translation on the page

- The translation appears right under each paragraph. Short text in menus, navigation bars, tabs, table cells… is translated **on the same line** (e.g. *Home · Trang chủ*) so the page layout doesn't break.
- Also translates content inside web components (Shadow DOM), content that is hidden when you turn it on (tabs, collapsed sections: translated when you open them) and content the page updates by itself. Content inside iframes, input fields and code blocks is not translated.
- Paragraphs that fail to translate (e.g. Google temporarily rate-limits requests) are retried automatically; the number of failed paragraphs is shown on the badge at the bottom right.
- After updating or reloading the extension, just turn bilingual mode on again (no need to reload the page).

### Summarizing highlighted text

- Highlight text **longer than 100 characters** → two small buttons, **Tóm tắt đoạn này** and **Dịch đoạn này**, appear right below the selection. Summarize shows the result card next to that text and sends **only that text** to the AI; translate shows the translation popup right next to it.
- While a long enough selection is active, the floating button, the popup (icon or `Alt+S`), the **Tóm tắt trang này** button in the Side Panel and right-click → *Tóm tắt đoạn đã chọn* also summarize only that text. Selections shorter than 100 characters show no buttons and the whole page is summarized.
- Short selections get a more compact summary (fewer points). Selection summaries are not cached, so they don't affect an existing summary of the whole page.
- The buttons don't appear for selections inside input fields. They hide when you clear the selection, scroll or press `Esc`, and are turned off together with the **Hiện nút tóm tắt nổi trên trang** (*Show the floating summary button*) option.

Summary language: **Song ngữ Anh–Việt** (*Bilingual English–Vietnamese*, default) · Tiếng Việt (*Vietnamese*) · English · Theo ngôn ngữ trang (*Page language*). The **Sao chép** button copies both the Vietnamese and the English parts.

### Chat about the page

- The **Hỏi đáp** tab in the Side Panel: ask anything about the current page. The AI reads the page content directly (up to the first 20,000 characters) together with the summary you just read, so it can answer details that are not in the summary. The **Hỏi thêm** button under the summary jumps straight to this tab.
- Clicking a **suggestion chip** in the Hỏi đáp tab **sends** that question **immediately** (no need to click Send); whatever you were typing in the input box is kept. The **✉️ Viết phản hồi** chip is the exception: it only fills the input box (cursor at the end) so you can add a **reply style** and then click Send yourself.
- The **✉️ Viết phản hồi** chip is **always shown** in the Hỏi đáp tab, whatever the page: Gmail, Outlook, Freshdesk / Zendesk / Help Scout tickets…, or any page with a message to answer. On pages that look like mail or a helpdesk (detected from the domain, path and tab title, without reading the page content) the chip comes first; otherwise it comes last.
- Pick a **style** quickly with the buttons under the chip: *Lịch sự* (*Polite*) · *Ngắn gọn* (*Brief*) · *Xin lỗi & giải thích* (*Apologize & explain*) · *Từ chối khéo* (*Decline politely*) · *Hỗ trợ khách hàng* (*Customer support*) (click several to combine), or type your own. The style you used last time is pre-filled next time.
- **Highlight the message to answer** (even inside an iframe, like a ticket body) and click Send: the AI answers exactly that text, and the context bar says "kèm đoạn bôi đen" (*with highlighted text*). The highlighted text (20 characters or more) is kept for the whole conversation until you highlight something else or click 🗑. Without a selection, the AI answers the email open on screen; for an email thread or ticket it answers the **latest message from the sender/customer** (skipping internal notes and your earlier replies). The draft is written **in the language of the message being answered** (unless you ask otherwise), has a Subject line, and uses `[placeholders]` for dates, prices, commitments or the sender's name that are not in the message: the AI never makes up information. If the page has no message to answer, the AI says so and asks you to highlight the message.
- If the page content cannot be read, the tab shows an error and **does not send** the question (so the AI doesn't answer as if it had never seen the page); click ⟳ to read it again.
- Answers appear word by word; `Shift+Enter` adds a new line; the **Dừng** (*Stop*) button stops the answer but keeps what was already written; each answer has a **Sao chép** button.
- Multi-turn conversations keep their context and are stored temporarily **per page** in session storage (cleared when the browser closes): closing and reopening the Side Panel on the same page continues the conversation. The ⟳ button re-reads the page, the 🗑 button clears the conversation immediately.
- The AI answers in the language of your question.

### Floating summary button

- Shown on every web page (except Chrome's system pages, the Chrome Web Store and PDFs). The button only builds its UI and **does not read the page until you click it** (the only exception is text you highlight, whose length is measured locally to decide whether to show the **Tóm tắt đoạn này** / **Dịch đoạn này** buttons; it is not sent anywhere).
- Results share the same cache as the popup and the Side Panel. The **Mở bảng đầy đủ** button in the card opens the Side Panel (if Chrome refuses, press `Alt+S` and click **Mở bảng đầy đủ** in the popup).
- To turn the button off: **Cài đặt** tab → uncheck **Hiện nút tóm tắt nổi trên trang** (applies immediately, no page reload needed).
- After updating or reloading the extension, reload the open pages so the button works again.

### Themes

**Cài đặt** tab → **Giao diện** (*Theme*): *Mặc định (xanh lá)* or *Trắng hồng dịu*. Applies to the popup, the Side Panel, the floating button, the summary card, the selection translation popup and the bilingual badge on the page. The pink theme always stays light (even when your system is in dark mode) and meets WCAG AA contrast.

## Supported AI providers

| Provider | Default model | Notes |
|---|---|---|
| **OpenRouter** (default) | *(empty)* – picks a free model automatically | See below |
| OpenAI | `gpt-6-luna` | OpenAI's cheapest current model |
| Anthropic | `claude-haiku-5-5` | Called directly from the browser (`anthropic-dangerous-direct-browser-access` header) |
| Google Gemini | `gemini-3.6-flash` | Free tier available on AI Studio |
| OpenAI-compatible | `llama3.1` @ `http://localhost:11434/v1` | Ollama / LM Studio… Ollama needs the environment variable `OLLAMA_ORIGINS=chrome-extension://*` |

Model names can be edited freely in Settings. The translation engine can be switched to **AI** (better quality for specialized text, uses tokens).

### OpenRouter – free models

- Leave the **Model** field empty → the extension fetches the list of free models (models ending in `:free`) from OpenRouter and uses the first one.
- To pick a specific model: click **Tải danh sách model miễn phí** (*Load free models*) in the Settings tab → choose a model in the Model field or click a model suggestion chip → **Lưu**.
- Free models **still need a (free) API key**, created at <https://openrouter.ai/keys>.
- Free models are rate-limited (per minute and per day, set by OpenRouter). If you hit the limit, wait a while, switch to another free model, or use another provider.

## Privacy

The extension has **no server of its own**, no analytics, and collects no data. Settings and API keys are stored only on your computer (`chrome.storage.local`, not synced through your Google account). Data leaves your computer only when you actively use a feature:

| When you… | Data sent | Sent to |
|---|---|---|
| Summarize (popup / `Alt+S`, Side Panel, floating button, right-click menu) | The title, URL and text of the article (or the highlighted text), up to 12,000 / 20,000 / 32,000 characters depending on the length | The AI provider you chose. The default is OpenRouter, which forwards it to the model's provider |
| Summarize in **Bilingual** mode (default) | Additionally: the Vietnamese summary (not the whole page) to translate it into English | `translate.googleapis.com` (Google Translate). If Google fails, it is sent to the AI provider |
| Summarize when the AI answers in the wrong language (e.g. a Chinese page → a Chinese summary) | Additionally: that summary, to translate it into the chosen language | **Bilingual** mode: Google Translate, or the AI provider if that fails. *Tiếng Việt* / *English* mode: the AI provider only |
| Turn on page translation, translate a selection, quick translate | The text of the paragraphs to translate | The selected translation engine: Google (default) or the AI provider |
| Chat about the page (**Hỏi đáp** tab) | Your question + the page's title, URL and text (up to 20,000 characters) + the text you have highlighted (if any, up to 8,000 characters) + the summary you are viewing (if any) + the previous turns | The AI provider you chose |
| Test the connection | A short test sentence | The AI provider |
| Load free models / leave the Model field empty | None of your data (only reads the public model list) | `openrouter.ai` |

- **Simply opening a page sends nothing.** The floating button only builds its UI. Page content is read only when you click yourself, and the web page's scripts cannot "click for you" (the extension ignores all synthetic clicks).
- **Summaries** and **Hỏi đáp conversations** (including the page text read for that tab) are stored only temporarily in session storage (`chrome.storage.session`) and are cleared when the browser closes; clear a conversation with the 🗑 button in the Hỏi đáp tab.
- **Free models:** data sent is subject to each provider's policy. Some free models on OpenRouter may be logged or used for training by their provider; check the privacy settings in your OpenRouter account.
- **For sensitive content** (emails, internal documents), use one of these options:
  - use a paid key from a provider that commits to not storing data;
  - run a model locally with **Ollama** (the *OpenAI-compatible* provider), so data never leaves your computer;
  - choose *Tiếng Việt* or *English* as the summary language instead of *Song ngữ*, so summaries are not sent to Google Translate;
  - switch the *Bộ máy dịch* (*Translation engine*) to AI.
- **Permissions the extension requests:**
  - `<all_urls>` + content script: show the floating button on every page, read content when you ask, and call the AI provider / Google Translate APIs;
  - `scripting`, `activeTab`, `tabs`: read the content of the current tab when summarizing or translating;
  - `storage`: save settings;
  - `sidePanel`, `contextMenus`: user interface.

## Current limitations

- Does not work on `chrome://` pages, the Chrome Web Store or the built-in PDF viewer (Chrome blocks scripts there). PDF upload, as in the original extension, is not available yet.
- The Google Translate endpoint used is the public web endpoint (`translate.googleapis.com … client=gtx`) with no SLA; heavy translation may be rate-limited temporarily → switch to the AI engine.
- OpenRouter's free models are rate-limited, and the list of free models may change over time.
- SPA pages that redraw the DOM constantly: translations are re-inserted up to 3 times per paragraph; after that, turn bilingual mode off and on again to retranslate.
- Summarizing highlighted text reads only the selection in the main page (not selections inside iframes or input fields).

## Changelog

### v1.3.4
- **New look** for the popup, the Side Panel and the floating button: frosted-glass cards, a tab bar whose highlight slides to the selected tab, and icons on tabs and buttons.
- **Cài đặt** tab: pick the AI provider with cards (OpenRouter, Gemini, Claude, OpenAI, Local AI) and pick a model quickly with **model suggestion chips** (including the free models you just loaded).
- The selection translation popup and the bilingual badge follow the current theme (including *Trắng hồng dịu*); the two buttons next to highlighted text and the translation popup now appear with a subtle animation.
- **Write a reply**: when the message being answered is in a foreign language, the draft is always written in that language (even if you ask in Vietnamese), unless you explicitly write "bằng tiếng Việt" (*in Vietnamese*).

### v1.3.3
- Highlighting long text now also shows a **Dịch đoạn này** button next to **Tóm tắt đoạn này**; click it to see the English ⇄ Vietnamese translation in a popup (with a Copy button).
- The selection translation popup appears **right above the point where you released the mouse** (flipping below or shrinking when there is not enough room), and is no longer pushed off screen for long text.

### v1.3.2
- The **✉️ Viết phản hồi** chip is **always shown** in the Hỏi đáp tab (it used to appear only on webmail, so Freshdesk/Zendesk tickets… didn't have it). Pages that look like mail or a helpdesk only decide whether the chip comes first or last.
- Added **quick style** buttons for replies (Polite, Brief, Apologize & explain, Decline politely, Customer support) and the extension **remembers the style** you used last time.
- **Highlight the message to answer** (iframes are read too, like a ticket body): the AI answers exactly that text, keeps it for the whole conversation, and 🗑 clears it; if the page fails to read but there is a highlighted message, it can still be sent.
- For email threads and tickets, the AI answers the **latest message from the sender/customer** and skips internal notes; if there is no message to answer, it asks you to highlight one.
- The highlighted text is sent to the AI provider in chats (up to 8,000 characters); this has been added to the privacy table.

### v1.3.1
- **Hỏi đáp** tab: clicking a suggestion chip **sends it immediately**, no need to click Send; text you were typing in the input box is kept. The **✉️ Viết email phản hồi** (*Write a reply email*) chip is the exception: it only fills the input box so you can add a reply style (polite, brief, decline politely…) and then click Send yourself; the AI follows the style you ask for.
- No more duplicate sends when double-clicking a chip or sending repeatedly while the page is being read; the **Dừng** button works even while the page is being read.
- If reading the page fails (or the page has almost no text), an error is shown and the question is not sent, instead of the AI answering as if it had never seen the page.
- **Write a reply email**: answers the email open on screen (the latest message of a thread), written in the email's language, with a Subject line, using `[placeholders]` for information not in the email and never making things up. Page content is treated as untrusted data and cannot give the AI instructions.

### v1.3.0
- **New Hỏi đáp tab** in the Side Panel: chat with the AI about the current page after summarizing it. The AI reads the page content directly (up to 20,000 characters) together with the open summary, so it can answer details that are not in the summary. The **Hỏi thêm** button under the summary jumps straight to this tab.
- Answers appear word by word, `Shift+Enter` adds a new line, a **Dừng** button while streaming (keeps what was written) and **Sao chép** for each answer.
- On webmail (Gmail, Outlook…), the suggestions include a **✉️ Viết email phản hồi** chip: the AI drafts a reply to the open email, in the email's language.
- Clicking a suggestion chip sends it immediately (except ✉️ Viết email phản hồi, which fills in the question so you can add a reply style and send it yourself); double-clicking or sending repeatedly while the page is being read no longer sends duplicates; if reading the page fails, an error is shown instead of the AI answering without the page content.
- Conversations are stored temporarily per page in session storage (cleared when the browser closes); ⟳ re-reads the page, 🗑 clears the conversation.

### v1.2.1
- Display name changed to **Lan Brieft** (formerly ViBrief). The repo, download links and zip file name stay the same; saved settings and API keys are not affected.
- **Summarize highlighted text**: highlight more than 100 characters → a **Tóm tắt đoạn này** button appears next to the selection, the result card appears right there, and only that text is sent to the AI.
- The floating button, popup / `Alt+S`, Side Panel and the new right-click menu item *Tóm tắt đoạn đã chọn* all pick up the highlighted text (previously it needed more than 300 characters and often returned the cached summary of the whole page).
- Short selections get a more compact summary; selection summaries don't overwrite the whole-page cache.

### v1.2.0
- `Alt+S` opens the quick-summary popup (previously nothing happened because Chrome blocked opening the Side Panel). The active shortcuts are shown at the bottom of the popup and in the **Cài đặt → Phím tắt** tab, marked *Chưa gán* if there is a conflict, with a **Đổi phím tắt** button.
- More reliable bilingual translation: block links, custom elements, text next to nested lists, Shadow DOM content, content hidden when turned on (tabs, collapsed sections) and content the page updates by itself are now translated; automatic retries when Google rate-limits requests.
- Short text in menus, navigation bars, tabs and table cells is translated on the same line (e.g. *Home · Trang chủ*) so the layout doesn't break.

---

Developed by [Kobe](https://github.com/kobevn9x).
