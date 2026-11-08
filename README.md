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

## 🛠 ابزارهای ارائه‌شده در سرور MCP

وقتی سرور را در اجنت رجیستر می‌کنید، ۴ ابزار زیر در دسترس اجنت قرار می‌گیرد:

1. **`ask_gapgpt_chat`**:
   ارسال درخواست به چت گپ و دریافت پاسخ همراه با شناسه مکالمه (با پشتیبانی از fallback و تعیین مدل و سطح تفکر).
2. **`get_gapgpt_quota`**:
   استعلام وضعیت سهمیه چت، محدودیت‌های ۳ ساعته و روزانه.
3. **`get_gapgpt_chat_history`**:
   مشاهده و بازخوانی تاریخچه پیام‌های یک چت خاص با `conversation_id`.
4. **`list_gapgpt_recent_chats`**:
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
```
سپس اجرا کنید:
```bash
docker compose up -d --build
```
سرویس روی پورت `8080` بالا می‌آید و اندپوینت‌های زیر را فراهم می‌کند:
- `POST /v1/chat/completions` : استاندارد سازگار با OpenAI (قابل استفاده در تمامی کلاینت‌ها، اسکریپت‌ها، Cursor، OpenWebUI و ...)
- `POST /ask` : ارسال مستقیم سوال با تعیین Effort و شناسه مکالمه
- `GET /quota` : وضعیت سهمیه چت
- `GET /health` : بررسی سلامت سرویس

---

## 🌐 استفاده مستقیم از سرویس ابری (Hosted on Cloud)

سرویس اختصاصی بر روی دامنه با پروتکل امن HTTPS و گواهی SSL معتبر فعال است:
* **Base URL:** `https://gapgpt.desktopcenter.ir`

### نمونه ارسال درخواست به اندپوینت OpenAI:
```bash
curl -X POST https://gapgpt.desktopcenter.ir/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus",
    "messages": [
      {"role": "user", "content": "چک‌لیست ایمن‌سازی دیتابیس پستگرس را ارائه بده"}
    ]
  }'
```

### نمونه استعلام سهمیه حساب از طریق کلود:
```bash
curl -s https://gapgpt.desktopcenter.ir/quota
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
