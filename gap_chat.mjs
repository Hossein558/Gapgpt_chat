import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPythonPath() {
  if (process.env.GAPGPT_PYTHON && fs.existsSync(process.env.GAPGPT_PYTHON)) {
    return process.env.GAPGPT_PYTHON;
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
  const bundled = path.join(localAppData, 'Programs', 'GapGPT', 'resources', 'gap-runtime', 'python', 'python.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return 'python';
}

const PYTHON_PATH = getPythonPath();

let liveAccessToken = null;
let liveRefreshToken = null;

export function getTokens() {
  if (liveAccessToken) {
    return { accessToken: liveAccessToken, refreshToken: liveRefreshToken || '' };
  }

  // 1. Direct environment variable (Ideal for Linux, Docker, Cloud VMs)
  if (process.env.GAPGPT_TOKEN && process.env.GAPGPT_TOKEN.trim()) {
    liveAccessToken = process.env.GAPGPT_TOKEN.trim();
    liveRefreshToken = (process.env.GAPGPT_REFRESH_TOKEN || '').trim();
    return { accessToken: liveAccessToken, refreshToken: liveRefreshToken };
  }

  // 2. Local token file (.token)
  const tokenFile = path.join(__dirname, '.token');
  if (fs.existsSync(tokenFile)) {
    try {
      const content = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (content.startsWith('{')) {
        const data = JSON.parse(content);
        liveAccessToken = (data.accessToken || data.access || '').trim();
        liveRefreshToken = (data.refreshToken || data.refresh || '').trim();
        if (liveAccessToken) return { accessToken: liveAccessToken, refreshToken: liveRefreshToken };
      } else if (content) {
        liveAccessToken = content;
        return { accessToken: liveAccessToken, refreshToken: '' };
      }
    } catch {}
  }

  // 3. Fallback to Windows DPAPI via auth.py (Windows Desktop only)
  try {
    const res = spawnSync(PYTHON_PATH, [path.join(__dirname, 'auth.py'), '--json']);
    if (res.status === 0) {
      const data = JSON.parse(res.stdout.toString().trim());
      liveAccessToken = data.accessToken || '';
      liveRefreshToken = data.refreshToken || '';
      return { accessToken: liveAccessToken, refreshToken: liveRefreshToken };
    }
  } catch {}

  throw new Error('Failed to retrieve GapGPT access token (set GAPGPT_TOKEN env var for Linux/Docker)');
}

export function getAccessToken() {
  return getTokens().accessToken;
}

export function getRefreshToken() {
  return getTokens().refreshToken;
}

export function setLiveTokens(access, refresh) {
  if (access) liveAccessToken = access;
  if (refresh) liveRefreshToken = refresh;
  process.env.GAPGPT_TOKEN = access;
  if (refresh) process.env.GAPGPT_REFRESH_TOKEN = refresh;
}

export function persistTokens(access, refresh) {
  setLiveTokens(access, refresh);

  const tokenFile = path.join(__dirname, '.token');
  try {
    fs.writeFileSync(tokenFile, JSON.stringify({ accessToken: access, refreshToken: refresh || '' }, null, 2), 'utf-8');
  } catch {}

  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    try {
      let envContent = fs.readFileSync(envFile, 'utf-8');
      if (/GAPGPT_TOKEN=.*/.test(envContent)) {
        envContent = envContent.replace(/GAPGPT_TOKEN=.*/, `GAPGPT_TOKEN=${access}`);
      } else {
        envContent += `\nGAPGPT_TOKEN=${access}`;
      }

      if (refresh) {
        if (/GAPGPT_REFRESH_TOKEN=.*/.test(envContent)) {
          envContent = envContent.replace(/GAPGPT_REFRESH_TOKEN=.*/, `GAPGPT_REFRESH_TOKEN=${refresh}`);
        } else {
          envContent += `\nGAPGPT_REFRESH_TOKEN=${refresh}`;
        }
      }
      fs.writeFileSync(envFile, envContent, 'utf-8');
    } catch {}
  }
}

export function getTokenExpiryInfo() {
  try {
    const token = getAccessToken();
    const parts = token.split('.');
    if (parts.length < 2) {
      return { status: 'unknown', error: 'Invalid JWT token structure' };
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const exp = payload.exp ? new Date(payload.exp * 1000) : null;
    const iat = payload.iat ? new Date(payload.iat * 1000) : null;
    const now = new Date();

    let daysRemaining = null;
    let isExpired = false;
    let warning = null;

    if (exp) {
      const diffMs = exp.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
      isExpired = diffMs <= 0;
      if (isExpired) {
        warning = 'توکن منقضی شده است! لطفاً جهت تمدید از قابلیت auto-renew یا دستور python gap_chat.py --renew استفاده کنید.';
      } else if (daysRemaining < 3) {
        warning = `توکن در کمتر از ${daysRemaining} روز آینده منقضی خواهد شد.`;
      }
    }

    return {
      status: isExpired ? 'expired' : (daysRemaining !== null && daysRemaining < 3 ? 'expiring_soon' : 'active'),
      issued_at: iat ? iat.toISOString() : null,
      expires_at: exp ? exp.toISOString() : null,
      days_remaining: daysRemaining,
      is_expired: isExpired,
      warning: warning
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function loginWithCredentials(username, password) {
  const resp = await fetch('https://gapgpt.ir/api/v1/login_password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GapGPT-Desktop'
    },
    body: JSON.stringify({
      username: username.toLowerCase().trim(),
      password: password
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Login failed (HTTP ${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  if (data.status !== 'ok' || !data.access_token) {
    throw new Error(`Login failed: ${data.message || 'Invalid username or password'}`);
  }

  persistTokens(data.access_token, data.refresh_token || '');
  console.log(`✅ [AUTH-LOGIN] Successfully logged in as ${username}. New tokens saved.`);
  return { status: 'ok', source: 'password_login', tokens: { accessToken: data.access_token, refreshToken: data.refresh_token } };
}

export async function refreshAccessToken() {
  const refresh = getRefreshToken();

  if (refresh) {
    try {
      const resp = await fetch('https://gapgpt.ir/api/v1/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GapGPT-Desktop'
        },
        body: JSON.stringify({ refresh })
      });

      if (resp.ok) {
        const data = await resp.json();
        const newAccess = data.access || data.access_token;
        const newRefresh = data.refresh || data.refresh_token || refresh;
        if (newAccess) {
          persistTokens(newAccess, newRefresh);
          console.log('✅ [AUTH-RENEW] Successfully renewed GapGPT access token via refresh token.');
          return { status: 'ok', source: 'refresh_token', tokens: { accessToken: newAccess, refreshToken: newRefresh } };
        }
      } else {
        const err = await resp.text();
        console.warn(`⚠️ [AUTH-RENEW] Refresh token rejected (HTTP ${resp.status}): ${err}`);
      }
    } catch (e) {
      console.warn(`⚠️ [AUTH-RENEW] Refresh request failed: ${e.message}`);
    }
  }

  // Fallback: Login via username and password if provided in environment
  const username = (process.env.GAPGPT_USERNAME || '').trim();
  const password = (process.env.GAPGPT_PASSWORD || '').trim();
  if (username && password) {
    return await loginWithCredentials(username, password);
  }

  throw new Error('Cannot renew token: No valid refresh token or credentials (GAPGPT_USERNAME / GAPGPT_PASSWORD) available.');
}

export async function checkAndAutoRenewToken() {
  const info = getTokenExpiryInfo();
  if (info.is_expired || (info.days_remaining !== null && info.days_remaining < 2)) {
    console.log(`⏰ [AUTO-RENEW] Token is expired or expiring soon (${info.days_remaining} days). Auto-renewing...`);
    try {
      return await refreshAccessToken();
    } catch (err) {
      console.error(`❌ [AUTO-RENEW] Failed to auto-renew token: ${err.message}`);
      return { status: 'failed', error: err.message };
    }
  }
  return { status: 'skipped', reason: 'Token is healthy', days_remaining: info.days_remaining };
}

export async function uploadImageToGapGPT(imageInput) {
  const token = getAccessToken();
  let buffer;
  let filename = `upload-${Date.now()}.png`;
  let mimeType = 'image/png';

  if (typeof imageInput !== 'string') {
    throw new Error('Image input must be a string (URL, file path, or data URI / base64)');
  }

  const trimmed = imageInput.trim();

  // 1. Data URI: data:image/...;base64,...
  if (trimmed.startsWith('data:image/')) {
    const matches = trimmed.match(/^data:(image\/[a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1];
      const ext = mimeType.split('/')[1] || 'png';
      filename = `upload-${Date.now()}.${ext}`;
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      throw new Error('Invalid data URI format');
    }
  }
  // 2. HTTP / HTTPS URL
  else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`Failed to download image from URL (${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.startsWith('image/')) {
      mimeType = contentType;
      const ext = mimeType.split('/')[1] || 'png';
      filename = `image-${Date.now()}.${ext}`;
    }
  }
  // 3. Local file path
  else if (fs.existsSync(trimmed)) {
    buffer = fs.readFileSync(trimmed);
    const ext = path.extname(trimmed).toLowerCase().replace('.', '') || 'png';
    mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    filename = path.basename(trimmed);
  }
  // 4. Raw base64 string
  else {
    try {
      buffer = Buffer.from(trimmed, 'base64');
    } catch {
      throw new Error('Unrecognized image input: Not a valid URL, file path, or base64 data');
    }
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename);

  const uploadResp = await fetch('https://gapgpt.ir/api/v1/upload_file', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'GapGPT-Desktop'
    },
    body: form
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`GapGPT Image Upload failed (HTTP ${uploadResp.status}): ${errText}`);
  }

  const uploadData = await uploadResp.json();
  const fileToken = uploadData.token || uploadData.file_token || uploadData.id;
  if (!fileToken) {
    throw new Error('No file token returned from GapGPT upload: ' + JSON.stringify(uploadData));
  }

  return {
    file_token: fileToken,
    url: uploadData.url || '',
    filename: filename
  };
}

export function resolveModel(modelName) {
  const m = (modelName || 'claude-opus').toLowerCase();
  if (m.includes('opus')) {
    return { key: 'claude-opus', bot_name: 'A-CLAUDE', mode: 'opus', name: 'Claude Opus 5.5' };
  } else if (m.includes('fable')) {
    return { key: 'claude-fable', bot_name: 'A-CLAUDE', mode: 'fable', name: 'Claude Fable 5' };
  } else if (m.includes('sonnet') || m.includes('claude')) {
    return { key: 'claude-sonnet', bot_name: 'A-CLAUDE', mode: 'sonnet', name: 'Claude Sonnet 5.5' };
  } else if (m.includes('terra')) {
    return { key: 'gpt-terra', bot_name: 'A-GPT-5.6-TERRA', mode: '', name: 'GPT-6.1 Terra' };
  } else if (m.includes('astra') || m.includes('gpt-6')) {
    return { key: 'gpt-6-astra', bot_name: 'A-GPT-6-ASTRA', mode: '', name: 'GPT-6 Astra' };
  } else if (m.includes('deepseek')) {
    return { key: 'deepseek', bot_name: 'A-DEEPSEEK', mode: '', name: 'DeepSeek' };
  } else if (m.includes('gemini')) {
    return { key: 'gemini', bot_name: 'A-GEMINI', mode: '', name: 'Gemini' };
  }
  return { key: 'claude-opus', bot_name: 'A-CLAUDE', mode: 'opus', name: 'Claude Opus 5.5' };
}

export function resolveEffort(effortStr) {
  const e = (effortStr || 'high').toLowerCase().trim();
  if (e === 'high' || e === 'deep' || e === 'عمیق') {
    return { level: 'high', label: 'عمیق (Deep)', reasoning_effort: 'high' };
  } else if (e === 'medium' || e === 'thoughtful' || e === 'متفکر') {
    return { level: 'medium', label: 'متفکر (Thoughtful)', reasoning_effort: 'medium' };
  } else if (e === 'low' || e === 'fast' || e === 'quick' || e === 'سریع' || e === 'none' || e === 'off') {
    return { level: 'none', label: 'سریع (Fast)', reasoning_effort: undefined };
  }
  return { level: 'high', label: 'عمیق (Deep)', reasoning_effort: 'high' };
}

export async function getQuota() {
  const token = getAccessToken();
  const resp = await fetch('https://gapgpt.ir/api/v1/profile', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'GapGPT-Desktop',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch profile: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const sub = data.subscription || {};
  const lim = data.limits || {};

  return {
    plan: sub.subtype === 'P' ? 'Pro (حرفه‌ای)' : (sub.subtype || 'Standard'),
    daily_limit: sub.daily_gpt4_gen_limit || 2400,
    three_hour_limit: sub.three_hour_gpt4_gen_limit || 300,
    is_message_limited: !!lim.message_limited,
    next_reset_time: lim.next_message_time || null,
    valid_until: sub.human_readable_end_time || null,
    status: lim.message_limited ? 'محدود شده (نیاز به بازنشانی زمانی)' : 'کاملاً آزاد و در دسترس'
  };
}

// Single websocket attempt
function executeSocketQuery({ prompt, modelConfig, effortConfig, chatId, fileTokens = [], onChunk, timeoutMs }) {
  const token = getAccessToken();

  return new Promise((resolve, reject) => {
    let ws;
    let resolved = false;
    let timer = null;

    const sentRid = Math.floor(Math.random() * 1e8);
    let hasAcked = false;
    let targetChatToken = chatId;
    let targetMessageToken = '';
    let streamText = '';
    let fullResponse = '';
    let reasoning = '';
    let chunkDone = false;
    let messagesRemaining = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (ws) {
        try { ws.close(); } catch {}
      }
    }

    function tryResolve() {
      if (resolved || !hasAcked) return;
      let finalText = (fullResponse || streamText).trim();
      if (!finalText) return;

      resolved = true;
      cleanup();

      // Separate any embedded thinking / reasoning
      let cleanReasoning = reasoning.trim();
      const thinkMatch = finalText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
      if (thinkMatch) {
        cleanReasoning = (cleanReasoning ? cleanReasoning + '\n' : '') + thinkMatch[1].trim();
        finalText = finalText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
      }

      const cotMatch = finalText.match(/^(The user (?:is asking|wants|needs)[\s\S]*?(?:Let me|I will|I should)[\s\S]*?\n\n)([\s\S]+)$/i);
      if (cotMatch && !cleanReasoning) {
        cleanReasoning = cotMatch[1].trim();
        finalText = cotMatch[2].trim();
      }

      resolve({
        status: 'ok',
        conversation_id: targetChatToken,
        message_token: targetMessageToken,
        model: modelConfig.name,
        effort: effortConfig.label,
        messages_remaining: messagesRemaining,
        response: finalText,
        reasoning: cleanReasoning
      });
    }

    timer = setTimeout(() => {
      if (!resolved) {
        const finalText = (fullResponse || streamText).trim();
        if (finalText && hasAcked) {
          tryResolve();
        } else {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for GapGPT response (${timeoutMs}ms)`));
        }
      }
    }, timeoutMs);

    ws = new WebSocket('wss://gapgpt.ir/ws/salam', {
      headers: {
        'User-Agent': 'GapGPT-Desktop',
        'Origin': 'https://gapgpt.ir'
      }
    });

    ws.onopen = () => {
      const modeExtra = {};
      if (effortConfig.reasoning_effort) {
        modeExtra.reasoning_effort = effortConfig.reasoning_effort;
      }

      const actionPayload = {
        type: 'text_message',
        version: 4,
        text: prompt,
        bot_name: modelConfig.bot_name,
        file_tokens: fileTokens || [],
        allow_downgrade: false,
        enable_user_memory: false,
        mode: modelConfig.mode,
        mode_extra: modeExtra,
        chat_token: targetChatToken || '',
        health_card: true,
        video_card: true
      };

      const payload = {
        event: 'new_message',
        rid: sentRid,
        data: {
          action: actionPayload,
          chat_token: targetChatToken || '',
          chat_model: modelConfig.bot_name,
          custom_gpt_token: null,
          message_token: '',
          allow_downgrade: false,
          enable_user_memory: false
        },
        version: 98,
        token: token
      };

      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const eventName = msg.event;

        if (eventName === 'ack_new_message') {
          const data = msg.data || {};
          if (data.status === 'message_limit' || data.status === 'quota_exceeded') {
            resolved = true;
            cleanup();
            return resolve({
              status: 'quota_exceeded',
              is_limit_error: true,
              message: data.message || 'سقف پیام‌های این بازه در GapGPT تکمیل شده است.',
              next_message_time: data.next_message_time || null
            });
          }

          if (data.status === 'invalid_request') {
            resolved = true;
            cleanup();
            return reject(new Error('GapGPT error: ' + (data.message || 'invalid_request')));
          }

          hasAcked = true;
          if (typeof data.adv_messages_remaining === 'number') {
            messagesRemaining = data.adv_messages_remaining;
          }
          if (data.chat_token) targetChatToken = data.chat_token;
          if (data.chat?.token) targetChatToken = data.chat.token;
          if (data.message?.token) {
            targetMessageToken = data.message.token;
          }
        } else if (eventName === 'text_response_chunk') {
          if (!hasAcked) return;
          const data = msg.data || {};
          if (!targetMessageToken || data.mtoken === targetMessageToken) {
            if (data.text) {
              streamText += data.text;
              if (onChunk) onChunk(data.text);
            }
            if (data.done) {
              chunkDone = true;
              setTimeout(() => tryResolve(), 600);
            }
          }
        } else if (eventName === 'new_message') {
          if (!hasAcked) return;
          const m = msg.data?.message;
          if (m) {
            if (targetMessageToken && m.token !== targetMessageToken) {
              return;
            }

            if (m.chat_token) targetChatToken = m.chat_token;
            if (m.token) targetMessageToken = m.token;

            if (Array.isArray(m.response)) {
              for (const r of m.response) {
                if (r.type === 'text' && r.content) {
                  fullResponse = r.content;
                } else if (r.type === 'reasoning' && r.content) {
                  reasoning = r.content;
                }
              }
            }

            const isDone = m.completed_at || chunkDone || (m.status === 'done');
            if (isDone && (fullResponse || streamText)) {
              tryResolve();
            }
          }
        }
      } catch (err) {}
    };

    ws.onerror = (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('WebSocket connection error: ' + (err.message || 'Unknown error')));
      }
    };
  });
}

// Master query with Auto-Fallback and Graceful Degradation
export async function askGapChat({
  prompt,
  model = 'claude-opus',
  effort = 'high',
  chatId = '',
  images = [],
  autoFallback = true,
  onChunk = null,
  timeoutMs = 120000
}) {
  const primaryModelConfig = resolveModel(model);
  const effortConfig = resolveEffort(effort);

  // Upload images if any
  const fileTokens = [];
  if (Array.isArray(images) && images.length > 0) {
    for (const img of images) {
      if (!img) continue;
      try {
        const up = await uploadImageToGapGPT(img);
        if (up && up.file_token) {
          fileTokens.push(up.file_token);
        }
      } catch (err) {
        console.warn(`⚠️ [VISION] Image upload skipped: ${err.message}`);
      }
    }
  }

  // Fallback candidate chain
  const fallbackCandidates = ['claude-sonnet', 'deepseek'];

  // Attempt primary
  try {
    const res = await executeSocketQuery({
      prompt,
      modelConfig: primaryModelConfig,
      effortConfig,
      chatId,
      fileTokens,
      onChunk,
      timeoutMs
    });

    if (res.status === 'ok') {
      return res;
    }

    // If quota exceeded and autoFallback enabled:
    if (res.is_limit_error && autoFallback) {
      for (const fallbackKey of fallbackCandidates) {
        if (fallbackKey === primaryModelConfig.key) continue;
        const fbModelConfig = resolveModel(fallbackKey);
        try {
          const fbRes = await executeSocketQuery({
            prompt,
            modelConfig: fbModelConfig,
            effortConfig: resolveEffort('medium'),
            chatId,
            fileTokens,
            onChunk,
            timeoutMs: 60000
          });
          if (fbRes.status === 'ok') {
            fbRes.fallback_used = true;
            fbRes.original_model = primaryModelConfig.name;
            fbRes.fallback_note = `سهمیه ${primaryModelConfig.name} پر بود؛ پاسخ با مدل جایگزین ${fbRes.model} دریافت شد.`;
            return fbRes;
          }
        } catch {}
      }
    }

    // All fallbacks exhausted or limit reached -> Graceful Degradation signal to Agent
    const quotaInfo = await getQuota().catch(() => ({}));
    return {
      status: 'quota_exceeded',
      fallback_required: true,
      original_model: primaryModelConfig.name,
      message: res.message || 'سهمیه چت موقتاً تکمیل شده است.',
      next_reset_time: quotaInfo.next_reset_time || null,
      instruction_for_agent: 'سهمیه چت موقتاً پر شده است. اجنت باید بدون توقف، مستقیماً با مدل داخلی خودش استدلال و اجرای این مرحله را ادامه دهد.',
      response: ''
    };
  } catch (err) {
    throw err;
  }
}

export async function getChatHistory(chatId) {
  const token = getAccessToken();
  const resp = await fetch(`https://gapgpt.ir/api/v1/get_chat/token/${chatId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'GapGPT-Desktop',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    throw new Error(`Failed to get chat history: HTTP ${resp.status}`);
  }
  return await resp.json();
}

export async function listRecentChats(limit = 10) {
  const token = getAccessToken();
  const resp = await fetch(`https://gapgpt.ir/api/v1/chat_list?limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'GapGPT-Desktop',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    throw new Error(`Failed to list chats: HTTP ${resp.status}`);
  }
  return await resp.json();
}

// CLI handler
if (process.argv[1] && process.argv[1].endsWith('gap_chat.mjs')) {
  const args = process.argv.slice(2);
  let prompt = '';
  let model = 'claude-opus';
  let effort = 'high';
  let chatId = '';
  let isJson = false;
  const images = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' || args[i] === '-p') {
      prompt = args[++i];
    } else if (args[i] === '--model' || args[i] === '-m') {
      model = args[++i];
    } else if (args[i] === '--effort' || args[i] === '-e') {
      effort = args[++i];
    } else if (args[i] === '--chat-id' || args[i] === '-c') {
      chatId = args[++i];
    } else if (args[i] === '--image' || args[i] === '-i') {
      images.push(args[++i]);
    } else if (args[i] === '--json') {
      isJson = true;
    } else if (args[i] === '--status' || args[i] === '-s') {
      const info = getTokenExpiryInfo();
      console.log(JSON.stringify(info, null, 2));
      process.exit(0);
    } else if (args[i] === '--renew' || args[i] === '-r') {
      refreshAccessToken().then(res => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error('Renew error:', err.message);
        process.exit(1);
      });
      break;
    } else if (args[i] === '--quota' || args[i] === '-q') {
      getQuota().then(res => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error(err);
        process.exit(1);
      });
      break;
    } else if (args[i] === '--list') {
      const limit = parseInt(args[i + 1] || '10', 10);
      listRecentChats(limit).then(res => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error(err);
        process.exit(1);
      });
      break;
    } else if (args[i] === '--history') {
      const id = args[++i];
      getChatHistory(id).then(res => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      }).catch(err => {
        console.error(err);
        process.exit(1);
      });
      break;
    }
  }

  if (prompt || images.length > 0) {
    let printedStream = false;
    askGapChat({
      prompt: prompt || 'Analyze this image',
      model,
      effort,
      chatId,
      images,
      onChunk: isJson ? null : (chunk) => {
        printedStream = true;
        process.stdout.write(chunk);
      }
    }).then(result => {
      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (!printedStream && result.response) {
          console.log(result.response);
        }
        if (result.fallback_note) {
          console.log(`\n⚠️  [توجه: ${result.fallback_note}]`);
        }
        if (result.fallback_required) {
          console.log(`\n⚠️  [سهمیه چت موقتاً تکمیل شد. زمان بازنشانی: ${result.next_reset_time || 'به زودی'}]`);
        } else {
          console.log('\n--- [Conversation ID: ' + result.conversation_id + ' | Model: ' + result.model + ' (' + result.effort + ')] ---');
        }
      }
      process.exit(0);
    }).catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
  }
}
