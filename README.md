# Lan Brieft – Tóm tắt & Dịch song ngữ Anh ⇄ Việt

Extension Chrome (Manifest V3) lấy cảm hứng từ *TLDR Summarizer AI*, gồm 2 chức năng:

1. **Tóm tắt trang đang xem**: 1 câu TL;DR + 3/5/8 ý chính (từ khoá được tô sáng) + đoạn tóm tắt. Mặc định tóm tắt **song ngữ Anh–Việt** (mỗi câu tiếng Việt kèm bản tiếng Anh ngay bên dưới); có thể chọn chỉ Tiếng Việt / English / theo ngôn ngữ trang và độ dài. Xem nhanh trong popup khi bấm icon, hoặc trong Side Panel đầy đủ.
2. **Dịch song ngữ Anh ⇄ Việt ngay trên trang**: bản dịch chèn ngay dưới từng đoạn (kiểu Immersive Translate), tự nhận diện chiều dịch theo từng đoạn, chỉ dịch phần sắp cuộn tới để tiết kiệm. Kèm dịch đoạn đã bôi đen (chuột phải) và ô dịch nhanh trong panel.

## Cài đặt (chế độ developer)

1. Vào mục [**Releases**](https://github.com/kobevn9x/ViBrief/releases), tải file `vibrief-x.y.z.zip` của bản mới nhất rồi giải nén (hoặc bấm **Code → Download ZIP** ở trang chính).
2. Mở `chrome://extensions` → bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked** → chọn thư mục vừa giải nén.
4. Ghim icon Lan Brieft lên thanh công cụ.
5. Lấy API key **miễn phí** tại <https://openrouter.ai/keys> (cần tạo tài khoản OpenRouter).
6. Mở Side Panel (bấm icon hoặc `Alt+S` → **Mở bảng đầy đủ**) → tab **Cài đặt** → nhà cung cấp mặc định là **OpenRouter (model miễn phí)**, dán API key → **Lưu** → **Kiểm tra kết nối**.

Dịch bằng Google không cần key – dùng được ngay sau khi cài.

**Cập nhật lên bản mới:** tải file zip mới ở Releases, giải nén đè lên thư mục cũ, rồi bấm nút tải lại (⟳) trên thẻ Lan Brieft trong `chrome://extensions`. Cài đặt và API key đã lưu vẫn giữ nguyên.

## Cách dùng

| Việc | Thao tác |
|---|---|
| Tóm tắt ngay trên trang | Bấm **nút nổi** ở giữa cạnh phải màn hình → thẻ tóm tắt song ngữ hiện ngay cạnh nút (✕ hoặc `Esc` để đóng) |
| Tóm tắt nhanh | Bấm icon trên thanh công cụ hoặc `Alt+S` → popup hiện tóm tắt ngay cho trang đang xem |
| Mở bảng đầy đủ | Trong popup bấm **Mở bảng đầy đủ** → mở Side Panel (Tóm tắt · Dịch · Cài đặt) |
| Tóm tắt trong Side Panel | Chuột phải → *Tóm tắt trang này*, hoặc **Tóm tắt trang này** trong panel |
| Tóm tắt đoạn bôi đen | Kéo chuột bôi đen đoạn > 100 ký tự → bấm nút **Tóm tắt đoạn này** hiện ngay cạnh vùng chọn (hoặc chuột phải → *Tóm tắt đoạn đã chọn*) |
| Bật/tắt song ngữ | Tab **Dịch** → công tắc, hoặc `Alt+T`, hoặc chuột phải → *Dịch song ngữ trang này*; tắt bằng nút **Tắt** ở badge góc phải dưới |
| Dịch đoạn chọn | Bôi đen → chuột phải → *Dịch đoạn đã chọn* (popup nổi, có nút Sao chép) |
| Dịch nhanh | Tab **Dịch** → dán văn bản → **Dịch** (`Ctrl+Enter`) |

Phím tắt đang dùng hiện ở cuối popup và trong tab **Cài đặt** → **Phím tắt** (ghi *Chưa gán* nếu Chrome không gán được, thường do trùng với extension khác). Bấm **Đổi phím tắt** (hoặc mở `chrome://extensions/shortcuts`) để đặt lại.

### Dịch song ngữ trên trang

- Bản dịch hiện ngay dưới từng đoạn. Chữ ngắn trong menu, thanh điều hướng, tab, ô bảng… được dịch **cùng dòng** (vd. *Home · Trang chủ*) để không làm vỡ bố cục trang.
- Dịch cả nội dung trong web component (Shadow DOM), nội dung ẩn khi mới bật (tab, mục thu gọn — dịch khi bạn mở ra) và nội dung trang tự cập nhật. Không dịch nội dung trong iframe, ô nhập liệu, khối code.
- Đoạn dịch lỗi (vd. Google tạm giới hạn lượt gọi) được tự thử lại; số đoạn lỗi hiện trên badge góc phải dưới.
- Sau khi cập nhật/tải lại extension, chỉ cần bật lại song ngữ (không cần tải lại trang).

### Tóm tắt đoạn bôi đen

- Bôi đen một đoạn **dài hơn 100 ký tự** → nút nhỏ **Tóm tắt đoạn này** hiện ngay dưới vùng chọn; bấm vào thì thẻ tóm tắt hiện cạnh đoạn đó và **chỉ đoạn đó** được gửi cho AI.
- Khi đang bôi đen đoạn đủ dài, nút nổi, popup (icon hoặc `Alt+S`), nút **Tóm tắt trang này** trong Side Panel và chuột phải → *Tóm tắt đoạn đã chọn* cũng chỉ tóm tắt đoạn đó. Đoạn ngắn hơn 100 ký tự thì không hiện nút và vẫn tóm tắt cả trang.
- Đoạn ngắn được tóm tắt gọn hơn (ít ý hơn). Kết quả của đoạn chọn không lưu bộ nhớ đệm, nên không ảnh hưởng bản tóm tắt cả trang đã có.
- Không hiện nút khi bôi đen trong ô nhập liệu. Nút ẩn đi khi bỏ chọn, cuộn trang hoặc nhấn `Esc`; tắt cùng tuỳ chọn **Hiện nút tóm tắt nổi trên trang**.

Ngôn ngữ tóm tắt: **Song ngữ Anh–Việt** (mặc định) · Tiếng Việt · English · Theo ngôn ngữ trang. Nút **Sao chép** chép cả phần tiếng Việt và phần tiếng Anh.

### Nút tóm tắt nổi

- Hiện trên mọi trang web (trừ trang hệ thống của Chrome, Chrome Web Store và PDF). Nút chỉ dựng giao diện, **không đọc nội dung trang cho tới khi bạn bấm** (riêng đoạn bạn bôi đen thì chỉ được đo độ dài ngay trên máy để quyết định hiện nút **Tóm tắt đoạn này**, không gửi đi đâu).
- Kết quả dùng chung bộ nhớ đệm với popup và Side Panel. Nút **Mở bảng đầy đủ** trong thẻ mở Side Panel (nếu Chrome không cho, nhấn `Alt+S` rồi bấm **Mở bảng đầy đủ** trong popup).
- Tắt nút: tab **Cài đặt** → bỏ chọn **Hiện nút tóm tắt nổi trên trang** (áp dụng ngay, không cần tải lại trang).
- Sau khi cập nhật/tải lại extension, cần tải lại các trang đang mở để nút hoạt động lại.

### Giao diện

Tab **Cài đặt** → **Giao diện**: *Mặc định (xanh lá)* hoặc *Trắng hồng dịu*. Áp dụng cho popup, Side Panel, nút nổi và thẻ tóm tắt trên trang. Theme hồng luôn ở tông sáng (kể cả khi máy đang ở chế độ tối) và đạt độ tương phản WCAG AA.

## Nhà cung cấp AI hỗ trợ

| Provider | Model mặc định | Ghi chú |
|---|---|---|
| **OpenRouter** (mặc định) | *(để trống)* – tự chọn model miễn phí | Xem mục bên dưới |
| OpenAI | `gpt-6-luna` | Model rẻ nhất hiện tại của OpenAI |
| Anthropic | `claude-haiku-5-5` | Gọi trực tiếp từ trình duyệt (header `anthropic-dangerous-direct-browser-access`) |
| Google Gemini | `gemini-3.6-flash` | Có free tier trên AI Studio |
| OpenAI-compatible | `llama3.1` @ `http://localhost:11434/v1` | Ollama / LM Studio… Với Ollama cần đặt biến môi trường `OLLAMA_ORIGINS=chrome-extension://*` |

Tên model sửa tự do trong Cài đặt. Bộ máy dịch có thể chuyển sang **AI** (chất lượng tốt hơn với văn bản chuyên ngành, tốn token).

### OpenRouter – model miễn phí

- Để trống ô **Model** → extension tự lấy danh sách model miễn phí (các model có đuôi `:free`) từ OpenRouter và dùng model đầu tiên.
- Muốn chọn model cụ thể: bấm **Tải danh sách model miễn phí** trong tab Cài đặt → chọn một model trong ô Model → **Lưu**.
- Model miễn phí **vẫn cần API key** (miễn phí) tạo tại <https://openrouter.ai/keys>.
- Model miễn phí bị giới hạn số lượt gọi (theo phút và theo ngày, do OpenRouter quy định). Nếu gặp lỗi giới hạn, đợi một lúc, đổi sang model miễn phí khác, hoặc dùng provider khác.

## Quyền riêng tư

Extension **không có máy chủ riêng**, không có analytics, không thu thập dữ liệu. Cài đặt và API key chỉ lưu trên máy bạn (`chrome.storage.local`, không đồng bộ qua tài khoản Google). Dữ liệu chỉ rời máy khi bạn chủ động dùng một chức năng:

| Khi bạn… | Dữ liệu được gửi | Gửi tới |
|---|---|---|
| Tóm tắt (popup / `Alt+S`, Side Panel, nút nổi, menu chuột phải) | Tiêu đề, URL và chữ của bài (hoặc đoạn đang bôi đen), tối đa 12.000 / 20.000 / 32.000 ký tự tuỳ độ dài | Nhà cung cấp AI bạn chọn. Mặc định là OpenRouter, nơi chuyển tiếp tới nhà cung cấp của model |
| Tóm tắt ở chế độ **Song ngữ** (mặc định) | Thêm: bản tóm tắt tiếng Việt (không phải cả trang) để dịch sang tiếng Anh | `translate.googleapis.com` (Google Translate). Nếu Google lỗi thì gửi cho nhà cung cấp AI |
| Tóm tắt mà AI trả lời sai ngôn ngữ (vd. trang tiếng Trung → tóm tắt tiếng Trung) | Thêm: bản tóm tắt đó để dịch sang ngôn ngữ đã chọn | Chế độ **Song ngữ**: Google Translate, lỗi thì nhà cung cấp AI. Chế độ *Tiếng Việt* / *English*: chỉ nhà cung cấp AI |
| Bật dịch song ngữ trang, dịch đoạn chọn, dịch nhanh | Chữ của các đoạn cần dịch | Bộ máy dịch đang chọn: Google (mặc định) hoặc nhà cung cấp AI |
| Kiểm tra kết nối | Một câu kiểm tra ngắn | Nhà cung cấp AI |
| Tải danh sách model miễn phí / để trống ô Model | Không gửi dữ liệu của bạn (chỉ đọc danh sách model công khai) | `openrouter.ai` |

- **Chỉ mở trang thì không gửi gì.** Nút nổi chỉ dựng giao diện. Nội dung trang chỉ được đọc khi chính bạn bấm, và script của trang web không thể "bấm hộ" (extension bỏ qua mọi cú bấm giả).
- **Kết quả tóm tắt** chỉ lưu tạm trong bộ nhớ phiên (`chrome.storage.session`) và mất khi đóng trình duyệt.
- **Model miễn phí:** dữ liệu gửi đi tuân theo chính sách của từng nhà cung cấp. Một số model miễn phí trên OpenRouter có thể được nhà cung cấp lưu lại hoặc dùng để huấn luyện; hãy xem phần cài đặt quyền riêng tư trong tài khoản OpenRouter.
- **Nội dung nhạy cảm** (email, tài liệu nội bộ), nên chọn một trong các cách sau:
  - dùng key trả phí của nhà cung cấp có cam kết không lưu dữ liệu;
  - chạy model trên máy bằng **Ollama** (provider *OpenAI-compatible*), dữ liệu không rời máy;
  - chọn ngôn ngữ tóm tắt *Tiếng Việt* hoặc *English* thay vì *Song ngữ*, để bản tóm tắt không gửi sang Google Translate;
  - đổi *Bộ máy dịch* sang AI.
- **Quyền extension yêu cầu:**
  - `<all_urls>` + content script: hiện nút nổi trên mọi trang, đọc nội dung khi bạn yêu cầu, và gọi API của nhà cung cấp AI / Google Translate;
  - `scripting`, `activeTab`, `tabs`: đọc nội dung tab đang xem khi tóm tắt hoặc dịch;
  - `storage`: lưu cài đặt;
  - `sidePanel`, `contextMenus`: giao diện.

## Giới hạn hiện tại

- Không chạy trên `chrome://`, Chrome Web Store và trình xem PDF tích hợp (Chrome chặn script). Chưa có tải PDF lên như bản gốc.
- Endpoint Google Translate dùng là endpoint web công khai (`translate.googleapis.com … client=gtx`), không có SLA; dịch nhiều có thể bị giới hạn tạm thời → chuyển sang bộ máy AI.
- Model miễn phí của OpenRouter có giới hạn lượt gọi và danh sách model miễn phí có thể thay đổi theo thời gian.
- Trang SPA vẽ lại DOM liên tục: bản dịch được tự chèn lại tối đa 3 lần mỗi đoạn; sau đó tắt/bật lại song ngữ để dịch lại.
- Tóm tắt đoạn bôi đen chỉ đọc vùng chọn ở trang chính (không đọc vùng chọn trong iframe hay trong ô nhập liệu).

## Thay đổi

### v1.2.1
- Đổi tên hiển thị thành **Lan Brieft** (trước đây là ViBrief). Repo, link tải và tên file zip giữ nguyên; cài đặt và API key đã lưu không bị ảnh hưởng.
- **Tóm tắt đoạn bôi đen**: bôi đen đoạn > 100 ký tự → nút **Tóm tắt đoạn này** hiện cạnh vùng chọn, thẻ kết quả hiện ngay tại đó và chỉ đoạn đó được gửi cho AI.
- Nút nổi, popup / `Alt+S`, Side Panel và menu chuột phải mới *Tóm tắt đoạn đã chọn* đều tự nhận đoạn đang bôi đen (trước đây cần > 300 ký tự và hay trả lại bản tóm tắt cả trang đã lưu).
- Đoạn ngắn được tóm tắt gọn hơn; tóm tắt đoạn chọn không ghi đè bộ nhớ đệm của cả trang.

### v1.2.0
- `Alt+S` mở popup tóm tắt nhanh (trước đây bấm không thấy gì vì Chrome chặn mở Side Panel). Phím tắt đang dùng hiện ở cuối popup và tab **Cài đặt → Phím tắt**, báo *Chưa gán* nếu bị trùng, có nút **Đổi phím tắt**.
- Dịch song ngữ ổn định hơn: dịch được link dạng khối, thẻ tự định nghĩa, chữ nằm cạnh danh sách con, nội dung trong Shadow DOM, nội dung ẩn lúc bật (tab, mục thu gọn) và nội dung trang tự cập nhật; tự thử lại khi Google giới hạn lượt gọi.
- Chữ ngắn trong menu, thanh điều hướng, tab, ô bảng được dịch cùng dòng (vd. *Home · Trang chủ*) để không vỡ bố cục.

---

Phát triển bởi [Kobe](https://github.com/kobevn9x).
