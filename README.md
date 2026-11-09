# GapGPT Chat Bridge & MCP Server 🚀

یک پل ارتباطی هوشمند، میکروسرویس ابری و سرور **Model Context Protocol (MCP)** برای اتصال اجنت‌های هوش مصنوعی (**GapCode**, **Antigravity**, **Claude Desktop**, **Cursor**) به بخش **چت وب‌سرویس GapGPT**.

این پروژه طراحی شده تا استدلال‌های سنگین، طراحی معماری، عیب‌یابی‌ها و چک‌لیست‌های طولانی را به سهمیه بدون استفاده گفتگوی **Pro (۳۰۰ پیام در ۳ ساعت و ۲۴۰۰ پیام در هر روز)** با مدل‌های تراز اول مانند **Claude Opus 5.5 (عمیق)** محول کند و مصرف توکن اختصاصی اجنت را به صفر برساند.

> 🌐 **سرویس ابری زنده و مستقر بر دامنه:** [https://gapgpt.desktopcenter.ir](https://gapgpt.desktopcenter.ir)  
> 📖 **[گزارش فنی و داستان شکل‌گیری پروژه (JOURNEY.md)](JOURNEY.md)** را مطالعه کنید.

---

## 🌟 ویژگی‌های کلیدی

- **احراز هویت بدون نیاز به وارد کردن رمز (Zero-Config Auth):**
  استخراج خودکار کلید امن و توکن فعال از پایگاه داده امن GapGPT Desktop با استفاده از Windows DPAPI و AES-256-GCM.
- **پشتیبانی کامل از سرور پروتکل استاندارد MCP:**
  قابل اتصال مستقیم به GapCode، Antigravity و تمامی ابزارهای مبتنی بر استاندارد MCP.
- **تطبیق عمق پردازش (Reasoning Effort Level):**
  امکان تنظیم سطح استدلال برای مدل Opus:
  - `high` یا `عمیق` (Deep Reasoning)
  - `medium` یا `متفکر` (Thoughtful)
  - `low` یا `سریع` (Fast)
- **پشتیبانی از تداوم مکالمه (Multi-turn Conversation):**
  امکان ارسال شناسه چت (`conversation_id` / `chat_token`) جهت ادامه‌دادن بحث در یک سرفصل مشخص با حفظ تاریخچه.
- **مکانیزم تاب‌آوری و Fallback هوشمند (Graceful Degradation):**
  - در صورت پر شدن سهمیه ۳ ساعته `Claude Opus 5.5`، سیستم به صورت خودکار به مدل‌های سبک‌تر (`Claude Sonnet 5.5` یا `DeepSeek`) سوئیچ می‌کند.
  - در صورت اتمام کل ظرفیت، سیگنال `fallback_required: true` به اجنت ارسال می‌شود تا اجنت بدون توقف یا بروز خطای سیستمی، مستقیماً با مدل داخلی خودش کار را پیش ببرد.
- **رابط‌های متنوع:**
  دارای سرور MCP، اسکریپت ماژولار Node.js (با WebSockets بومی) و رابط خط فرمان CLI پایتون.

---

## 🤖 مدل‌های پشتیبانی‌شده

| شناسه در اسکریپت | نام در GapGPT | حالت و کاربرد |
| :--- | :--- | :--- |
| `claude-opus` | **Claude Opus 5.5** | قدرتمندترین مدل تحلیلی با استدلال عمیق (پیش‌فرض) |
| `claude-sonnet` | **Claude Sonnet 5.5** | سرعت بالا با تحلیل کیفی عالی |
| `claude-fable` | **Claude Fable 5** | استدلال متمرکز و خلاقانه |
| `gpt-6-astra` | **GPT-6 Astra** | مدل پرچم‌دار شرکت OpenAI |
| `gpt-terra` | **GPT-6.1 Terra** | مدل تحلیلی و مهندسی |
| `deepseek` | **DeepSeek** | کدنویسی، ریاضی و حل مسئله با عملکرد عالی |
| `gemini` | **Gemini** | پردازش عمومی سریع |

---

## 🛠 ابزارهای ارائه‌شده در سرور MCP (معماری دو هسته‌ای Dual-Engine)

وقتی سرور را در اجنت رجیستر می‌کنید، ابزارهای زیر به عنوان یک موتور دوگانه کامل در دسترس قرار می‌گیرد:

1. **sk_gapgpt_chat (GapChat Engine - مغز متفکر و حل مسئله):**
   ارسال درخواست به چت گپ و دریافت پاسخ همراه با شناسه مکالمه (با پشتیبانی از fallback، تعیین مدل، سطح تفکر عمیق و **پردازش چندوجهی تصویر Multimodal/Vision**). این بخش از سهمیه رایگان ۳ ساعته چت استفاده کرده و تغییری در فایل‌ها ایجاد نمی‌کند.
2. **
un_gapcode_task (GapCode Engine - بازوی اجرای خودکار):**
   واگذاری یک تسک کاملاً خودکار به موتور قدرتمند GapCode (gapcode exec). گپ‌کد مستقلاً وارد پوشه پروژه شده، فایل‌ها را می‌خواند، تغییرات را اعمال می‌کند، دستورات شل در ترمینال را ران می‌کند و خروجی تست‌ها را راستی‌آزمایی می‌کند.
3. **get_gapgpt_quota**:
   استعلام وضعیت سهمیه چت، محدودیت‌های ۳ ساعته و روزانه.
4. **get_gapgpt_auth_status**:
   بررسی وضعیت اعتبار توکن، تاریخ انقضا و روزهای باقی‌مانده.
5. **
enew_gapgpt_token**:
   تمدید خودکار توکن احراز هویت با استفاده از Refresh Token یا اطلاعات حساب کاربری.
6. **get_gapgpt_chat_history**:
   مشاهده و بازخوانی تاریخچه پیام‌های یک چت خاص با conversation_id.
7. **list_gapgpt_recent_chats**:
   فهرست‌گیری از آخرین گفتگوهای ثبت‌شده در حساب کاربر.

---

## 📦 نیازمندی‌ها

- سیستم‌عامل **ویندوز** (به دلیل رمزنگاری DPAPI ویندوز)
- نصب بودن نسخه دسکتاپ **GapGPT** و یک بار لاگین بودن در آن
- محیط ران‌تایم:
  - به صورت خودکار از `node.exe` و `python.exe` موجود در دایرکتوری برنامه GapGPT استفاده می‌شود.
  - یا Node.js نسخه 18+ و پایتون 3.9+ همراه با پکیج `cryptography` (`pip install cryptography`).

---

## ⚙️ نحوه نصب و پیکربندی

### ۱. کلون کردن مخزن
```bash
git clone https://github.com/Hossein558/Gapgpt_chat.git
cd Gapgpt_chat
```

### ۲. اتصال به GapCode
فایل تنظیمات گپ‌کد در مسیر `~/.gapcode/config.toml` (یا مسیر معادل) را باز کنید و بخش زیر را به `[mcp_servers]` اضافه نمایید:

```toml
[mcp_servers.gapgpt_chat]
command = "node"
args = ["C:\\path\\to\\Gapgpt_chat\\gapgpt_mcp.mjs"]
```

سپس با دستور زیر صحت اتصال را بسنجید:
```bash
gapcode mcp list
```

### ۳. اتصال به Claude Desktop
در فایل `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gapgpt_chat": {
      "command": "node",
      "args": [
        "C:\\path\\to\\Gapgpt_chat\\gapgpt_mcp.mjs"
      ]
    }
  }
}
```

### ۴. اتصال به Google Antigravity
در فایل `%USERPROFILE%\.gemini\config\mcp_config.json`:

```json
{
  "mcpServers": {
    "gapgpt_chat": {
      "command": "node",
      "args": [
        "C:\\path\\to\\Gapgpt_chat\\gapgpt_mcp.mjs"
      ]
    }
  }
}
```

---

## 🐳 استقرار در لینوکس، داکر (Docker) و کلود VM

این ابزار روی لینوکس و محیط‌های کانتینری به طور کامل و مستقل از ویندوز کار می‌کند. هسته وب‌سوکت آن هیچ وابستگی به GUI ندارد.

### ۱. استخراج توکن در ویندوز:
برای انتقال به لینوکس، ابتدا توکن خود را در سیستم ویندوزی استخراج کنید:
```bash
python gap_chat.py --export-token
```
خروجی به شما دستور `export GAPGPT_TOKEN="..."` را می‌دهد.

### ۲. اجرا با Docker Compose (سرور HTTP و OpenAI API):
یک فایل `.env` در کنار `docker-compose.yml` بسازید:
```env
GAPGPT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
# کلید امنیتی جهت محافظت از اندپوینت‌های عمومی (اختیاری اما شدیداً توصیه شده):
BRIDGE_API_KEY="your_secret_api_key_here"
```
سپس اجرا کنید:
```bash
docker compose up -d --build
```
سرویس به صورت کانتینری بالا می‌آید و اندپوینت‌های زیر را فراهم می‌کند:
- `POST /v1/chat/completions` : استاندارد سازگار با OpenAI با پشتیبانی کامل از **استریمینگ زنده (`"stream": true`)**
- `POST /ask` : ارسال مستقیم سوال با تعیین Effort و شناسه مکالمه
- `GET /quota` : وضعیت سهمیه چت و محدودیت‌های زمانی
- `GET /auth/status` : بررسی وضعیت سلامت توکن و روزهای باقی‌مانده تا انقضا
- `GET /health` : بررسی عمومی سلامت سرویس (Public)

---

## 🔒 امنیت و احراز هویت (API Key Security)

برای جلوگیری از سوءاستفاده افراد ناشناس در محیط‌های ابری، می‌توانید متغیر `BRIDGE_API_KEY` را در فایل `.env` تنظیم کنید. در این صورت تمامی اندپوینت‌های پردازشی محافظت شده و کلاینت‌ها باید کلید را در هدر ارسال کنند:

```bash
# با هدر استاندارد Bearer:
-H "Authorization: Bearer your_secret_api_key_here"

# یا با هدر X-API-Key:
-H "X-API-Key: your_secret_api_key_here"
```

> [!NOTE]
> اندپوینت `/health` جهت مانیتورینگ سلامت سرویس بدون نیاز به کلید باز می‌ماند.

---

## 🔄 اتوماسیون کامل تمدید توکن (Automated Headless Token Renewal)

در نسخه **v1.4.0**، سیستم به دو سازوکار خودکار برای تمدید توکن بدون نیاز به مداخله دستی مجهز شده است:

### ۱. تمدید کاملاً خودکار در پس‌زمینه (Zero-Touch Background Renewal)
- سرور HTTP به طور خودکار هر ۳۰ دقیقه یک‌بار اعتبار توکن را بررسی می‌کند.
- اگر کمتر از ۲ روز به انقضای توکن باقی مانده باشد، سرور به طور مستقل با اندپوینت استاندارد `https://gapgpt.ir/api/v1/token/refresh` توکن جدید را دریافت کرده، حافظه فعال و فایل‌های `.env` و `.token` را به‌روزرسانی می‌کند.

### ۲. اتصال با نام‌کاربری و رمز عبور (Headless Password Fallback)
می‌توانید متغیرهای زیر را در `.env` قرار دهید تا در صورت باطل شدن سشن، سرور مستقیماً وارد حساب شده و توکن‌های جدید دریافت کند:
```env
GAPGPT_USERNAME="your_email_or_username"
GAPGPT_PASSWORD="your_password"
```

### ۳. تمدید دستی / On-Demand از طریق API و خط فرمان:
```bash
# از طریق اندپوینت وب‌سرویس:
curl -X POST https://gapgpt.desktopcenter.ir/auth/renew \
  -H "Authorization: Bearer your_secret_api_key_here"

# از طریق خط فرمان:
python gap_chat.py --renew
# یا
node gap_chat.mjs --renew
```

---

## 👁️ پردازش چندوجهی تصویر (Multimodal / Vision Support)

مدل‌های برتر چت مانند **Claude Opus 5.5**, **Claude Sonnet 5.5** و **GPT-6 Astra** اکنون از طریق این پل از **پردازش مستقیم تصویر** پشتیبانی می‌کنند:

### ۱. ارسال تصویر در استاندارد OpenAI (`/v1/chat/completions`):
می‌توانید تصاویر را به صورت لینک اینترنتی (`https://...`) یا Base64 Data URI ارسال کنید:
```bash
curl -X POST https://gapgpt.desktopcenter.ir/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_api_key_here" \
  -d '{
    "model": "claude-opus",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "این نمودار معماری را تحلیل کن و نقاط ضعف امنیتی آن را بگو"},
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/architecture.png"
            }
          }
        ]
      }
    ]
  }'
```

### ۲. ارسال تصویر در اندپوینت مستقیم (`/ask`):
```bash
curl -X POST https://gapgpt.desktopcenter.ir/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_api_key_here" \
  -d '{
    "prompt": "متن موجود در این اسکرین‌شات ارور را بخوان و روش رفع آن را بگو",
    "model": "claude-opus",
    "images": [
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    ]
  }'
```

### ۳. ارسال تصویر در خط فرمان (CLI):
```bash
python gap_chat.py -p "این نمودار را تحلیل کن" -i "./architecture.png" -m claude-opus
```

---

## 🌐 استفاده مستقیم از سرویس ابری (Hosted on Cloud)

سرویس اختصاصی بر روی دامنه با پروتکل امن HTTPS و گواهی SSL معتبر فعال است:
* **Base URL:** `https://gapgpt.desktopcenter.ir`

### نمونه ارسال درخواست به اندپوینت OpenAI (با استریم یا بدون استریم):
```bash
curl -X POST https://gapgpt.desktopcenter.ir/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_api_key_here" \
  -d '{
    "model": "claude-opus",
    "stream": true,
    "messages": [
      {"role": "user", "content": "چک‌لیست ایمن‌سازی دیتابیس پستگرس را ارائه بده"}
    ]
  }'
```

### نمونه استعلام سهمیه حساب از طریق کلود:
```bash
curl -s https://gapgpt.desktopcenter.ir/quota \
  -H "Authorization: Bearer your_secret_api_key_here"
```
- `GET /quota` : وضعیت سهمیه چت
- `GET /health` : بررسی سلامت سرویس

### ۳. اجرا در لینوکس بدون داکر (Standalone):
```bash
export GAPGPT_TOKEN="eyJhbGciOi..."
node gap_chat.mjs -p "دستور لینوکسی برای بررسی دیسک" -m claude-opus
```

---

## 💻 استفاده از خط فرمان (CLI)

### پرسیدن سوال با Claude Opus 5.5 و تفکر عمیق:
```bash
python gap_chat.py -p "معماری مایکروسرویس را توضیح بده" -m claude-opus -e high
```

### ادامه دادن یک گفتگوی قبلی با ارسال شناسه چت:
```bash
python gap_chat.py -p "کدهای پایتونی بخش قبل را بنویس" -c "13c565c9-c891-4f4b-9de7-c4439f07a262"
```

### بررسی سهمیه باقی‌مانده:
```bash
python gap_chat.py --quota
```

### دریافت خروجی به فرمت JSON (مناسب اتوماسیون و اسکریپت‌ها):
```bash
python gap_chat.py -p "تست اتصال" --json
```

---

## 🧠 راهنمای استفاده برای اجنت‌ها

برای اینکه اجنت‌ها (مانند **GapCode**, **Antigravity**, **Cursor** یا **Claude Desktop**) به صورت خودکار متوجه شوند که باید کارهای فکری و محاسباتی سنگین را به این سرور MCP ارجاع دهند، قانون زیر را در فایل قوانین پروژه (`AGENTS.md` یا `GEMINI.md`) یا در بخش **Custom Instructions** قرار دهید:

```markdown
## سیاست مدیریت بهینه توکن و ارجاع کار
قبل از شروع کارهای سنگین، عیب‌یابی خطاهای پیچیده، نگارش معماری و چک‌لیست‌های ارتقا، 
همیشه ابتدا از ابزار MCP به نام `ask_gapgpt_chat` (با مدل `claude-opus` و سطح `effort: "high"`) 
برای پردازش موضوع استفاده کن. پاسخ را از چت استخراج کن و سپس اقدامات اجرایی (مثل ران کردن کامندها 
یا ویرایش فایل‌ها) را خودت به اتمام برسان. اگر ابزار خروجی `fallback_required: true` داد، مستقیماً با مدل داخلی ادامه بده.
```

این قانون تضمین می‌کند که اجنت‌ها به شکل خودکار و بهینه از توان تحلیلی **Claude Opus 5.5 عمیق** در وب‌چت بدون مصرف توکن‌های گران‌قیمت اجنت استفاده کنند و در صورت رسیدن به محدودیت سهمیه، کار بدون وقفه ادامه یابد.

---

## 📄 لایسنس
این پروژه تحت مجوز MIT منتشر شده است.
