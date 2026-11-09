import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  askGapChat,
  getQuota,
  listRecentChats,
  getChatHistory,
  getTokenExpiryInfo,
  refreshAccessToken,
  checkAndAutoRenewToken
} from './gap_chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const BRIDGE_API_KEY = (process.env.BRIDGE_API_KEY || '').trim();

// Excluded Conversation IDs (Strict Confidentiality Blacklist)
const EXCLUSIONS_FILE = path.join(__dirname, 'exclusions.json');
let excludedIds = [
  '5e07464b-76f3-42d5-a404-68b6a7e6b7cc',
  '388ebb05-83bc-4615-a0d3-0168772d3efe',
  '54ac95a2-6fc0-41aa-99b2-8140e915fc36',
  'ea524caf-adbb-44c0-b054-5f204b5cb7c0'
];

function loadExclusions() {
  try {
    if (fs.existsSync(EXCLUSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(EXCLUSIONS_FILE, 'utf-8'));
      if (Array.isArray(data.excluded_conversation_ids)) {
        for (const id of data.excluded_conversation_ids) {
          if (!excludedIds.includes(id)) excludedIds.push(id);
        }
      }
    }
  } catch (e) {}
}
loadExclusions();

function checkExclusion(payload) {
  if (!payload) return null;
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const id of excludedIds) {
    if (str.includes(id)) return id;
  }
  return null;
}

// ==========================================
// Persistent Conversation -> GapGPT Chat Token Store
// ==========================================
const SESSIONS_FILE = path.join(__dirname, 'session_store.json');
let chatSessionMap = new Map();

function loadSessionStore() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      chatSessionMap = new Map(Object.entries(data));
      console.log(`📂 Loaded ${chatSessionMap.size} chat session mappings.`);
    }
  } catch (e) {
    console.warn('⚠️ Could not load session_store.json:', e.message);
  }
}

function saveSessionStore() {
  try {
    if (chatSessionMap.size > 2000) {
      const keys = Array.from(chatSessionMap.keys());
      for (let i = 0; i < keys.length - 1500; i++) {
        chatSessionMap.delete(keys[i]);
      }
    }
    const obj = Object.fromEntries(chatSessionMap);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ Could not save session_store.json:', e.message);
  }
}

loadSessionStore();

function extractConversationKey(req, body) {
  if (isInternalTask(body)) return null;

  const headerChatId = req.headers['x-openwebui-chat-id'] || req.headers['x-chat-id'] || req.headers['x-conversation-id'];
  if (headerChatId && typeof headerChatId === 'string' && headerChatId.trim()) {
    return headerChatId.trim();
  }
  if (body.chat_id && typeof body.chat_id === 'string' && body.chat_id.trim()) {
    return body.chat_id.trim();
  }
  if (body.conversation_id && typeof body.conversation_id === 'string' && body.conversation_id.trim()) {
    return body.conversation_id.trim();
  }
  if (body.metadata?.chat_id && typeof body.metadata.chat_id === 'string' && body.metadata.chat_id.trim()) {
    return body.metadata.chat_id.trim();
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const raw = typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    if (raw && raw.trim().length > 3) {
      return 'conv_' + crypto.createHash('sha256').update(raw.trim()).digest('hex').slice(0, 24);
    }
  }
  return null;
}

function isInternalTask(body) {
  if (body.metadata?.task) return true;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 1) {
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';
    if (content.startsWith('### Task:') || 
        content.includes('Generate 1-3 broad tags') || 
        content.includes('Generate a concise, 3-5 word title') || 
        content.includes('Predict 3-5 useful messages') ||
        content.includes('Suggest follow-up')) {
      return true;
    }
  }
  return false;
}

function handleInternalTask(body) {
  const taskMeta = (body.metadata?.task || '').toLowerCase();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const taskContent = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');

  // 1. Title Generation Task
  if (taskMeta.includes('title') || taskContent.includes('Generate a concise, 3-5 word title') || (taskContent.startsWith('### Task:') && taskContent.toLowerCase().includes('title'))) {
    let title = 'تطبیق و بهینه‌سازی اسکریپت Jira';
    if (taskContent.includes('Participant Teams') || taskContent.includes('ScriptRunner')) {
      title = 'بروزرسانی Participant Teams در Jira';
    } else if (taskContent.includes('SQL') || taskContent.includes('DatabaseUtil')) {
      title = 'بهینه‌سازی کوئری SQL در اسکریپت';
    } else if (taskContent.includes('Portfolio Epic')) {
      title = 'پردازش Portfolio Epic در Jira';
    }
    return title;
  }

  // 2. Tags Generation Task
  if (taskMeta.includes('tags') || taskContent.includes('Generate 1-3 broad tags') || (taskContent.startsWith('### Task:') && taskContent.toLowerCase().includes('tag'))) {
    return '["Jira", "ScriptRunner", "Groovy", "SQL"]';
  }

  // 3. Follow-up / Prediction Generation Task
  if (taskMeta.includes('follow_up') || taskContent.includes('Predict 3-5 useful messages') || (taskContent.startsWith('### Task:') && taskContent.toLowerCase().includes('predict'))) {
    return '1. آیا ساختار SQL با دیتابیس همخوانی دارد؟\n2. رفتار کد در حالت DRY_RUN چگونه ارزیابی می‌شود؟\n3. نحوه مدیریت خطاها و لاگ‌ها در Production چیست؟';
  }

  return null;
}

if (!BRIDGE_API_KEY) {
  console.warn('⚠️  [SECURITY WARNING] BRIDGE_API_KEY is not set! Running in open public mode.');
} else {
  console.log('🔒 Security enabled: Protected endpoints require Authorization: Bearer <API_KEY>');
}

// Background Auto-Renewal check every 30 minutes
setInterval(async () => {
  try {
    await checkAndAutoRenewToken();
  } catch (err) {
    console.error('Background auto-renew check error:', err.message);
  }
}, 30 * 60 * 1000);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(payload);
}

function isAuthorized(req) {
  if (!BRIDGE_API_KEY) return true;
  const authHeader = req.headers['authorization'] || '';
  const xApiKey = req.headers['x-api-key'] || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token === BRIDGE_API_KEY) return true;
  }
  if (xApiKey === BRIDGE_API_KEY) return true;
  return false;
}

// Track in-flight generation requests so a restart/deploy never kills a live stream
let activeRequests = 0;
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  const isGeneration = req.method === 'POST' && /^\/(v1\/chat\/completions|ask)\/?$/.test((req.url || '').split('?')[0]);
  if (isGeneration) {
    if (shuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5', 'Connection': 'close' });
      return res.end(JSON.stringify({ error: { message: 'Bridge is restarting, please retry in a few seconds.', type: 'server_restarting' } }));
    }
    activeRequests++;
    let released = false;
    const release = () => { if (!released) { released = true; activeRequests--; } };
    res.on('finish', release);
    res.on('close', release);
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }

  // Public health check endpoint
  if (pathname === '/health' || pathname === '/') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'GapGPT-Bridge-HTTP',
      version: '1.5.0',
      auth_enabled: !!BRIDGE_API_KEY,
      features: ['openai-compatible', 'streaming-sse', 'multimodal-vision', 'auto-token-renew', 'conversation-exclusions'],
      excluded_conversations_count: excludedIds.length,
      timestamp: new Date().toISOString()
    });
  }

  // Protected endpoints authentication check
  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      error: {
        message: 'Unauthorized: Missing or invalid API Key. Provide Authorization: Bearer <API_KEY> or X-API-Key header.',
        type: 'invalid_request_error',
        code: 'unauthorized'
      }
    });
  }

  try {
    // Exclusions endpoints
    if (pathname === '/exclusions' && req.method === 'GET') {
      loadExclusions();
      return sendJson(res, 200, {
        status: 'ok',
        count: excludedIds.length,
        excluded_conversation_ids: excludedIds
      });
    }

    if (pathname === '/exclusions' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const newId = (body.conversation_id || body.id || '').trim();
      if (!newId) {
        return sendJson(res, 400, { error: 'Missing conversation_id to exclude' });
      }
      if (!excludedIds.includes(newId)) {
        excludedIds.push(newId);
        try {
          fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify({ excluded_conversation_ids: excludedIds }, null, 2), 'utf-8');
        } catch (e) {}
      }
      return sendJson(res, 200, {
        status: 'ok',
        message: `Conversation ID [${newId}] added to exclusion list`,
        excluded_conversation_ids: excludedIds
      });
    }

    // Auth and token expiration check
    if (pathname === '/auth/status' && req.method === 'GET') {
      const info = getTokenExpiryInfo();
      return sendJson(res, 200, info);
    }

    // Explicit Token Renewal endpoint
    if (pathname === '/auth/renew' && req.method === 'POST') {
      try {
        const ren = await refreshAccessToken();
        const info = getTokenExpiryInfo();
        return sendJson(res, 200, {
          status: 'ok',
          message: 'Token renewed successfully',
          renewal: ren,
          token_info: info
        });
      } catch (err) {
        return sendJson(res, 500, {
          error: {
            message: 'Token renewal failed: ' + err.message,
            type: 'token_renewal_error'
          }
        });
      }
    }

    // Quota check
    if (pathname === '/quota' && req.method === 'GET') {
      const quota = await getQuota();
      return sendJson(res, 200, quota);
    }

    // Direct Ask endpoint (Supports prompt, images, and exclusion enforcement)
    if (pathname === '/ask' && req.method === 'POST') {
      const body = await readJsonBody(req);

      // Enforce Exclusion Firewall Check
      const headerConvId = req.headers['x-antigravity-conversation-id'] || req.headers['x-conversation-id'] || '';
      const blockedId = checkExclusion(body) || checkExclusion(headerConvId);
      if (blockedId) {
        return sendJson(res, 403, {
          error: {
            message: `Blocked by server policy: Conversation ID [${blockedId}] is strictly confidential and excluded from GapGPT delegation.`,
            type: 'delegation_forbidden',
            code: 'conversation_excluded',
            excluded_id: blockedId
          }
        });
      }

      // Intercept Open WebUI background utility tasks (Title, Tags, Follow-ups) to prevent creating extra GapGPT sessions and burning quota
      const internalResult = handleInternalTask(body);
      if (internalResult !== null) {
        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          const chatId = `chatcmpl-${Date.now()}`;
          const chunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [{ index: 0, delta: { content: internalResult }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          const doneChunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        } else {
          return sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: internalResult },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          });
        }
      }

      const { prompt, model, effort, conversation_id, images } = body;
      if (!prompt && (!images || images.length === 0)) {
        return sendJson(res, 400, { error: 'Missing required field: prompt or images' });
      }
      const result = await askGapChat({
        prompt: prompt || 'Analyze this image',
        model: model || 'claude-opus',
        effort: effort || undefined,
        chatId: conversation_id || '',
        images: images || []
      });
      return sendJson(res, 200, result);
    }

    // OpenAI-compatible Chat Completions (/v1/chat/completions with Exclusion Check)
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJsonBody(req);

      // Enforce Exclusion Firewall Check
      const headerConvId = req.headers['x-antigravity-conversation-id'] || req.headers['x-conversation-id'] || '';
      const blockedId = checkExclusion(body) || checkExclusion(headerConvId);
      if (blockedId) {
        return sendJson(res, 403, {
          error: {
            message: `Blocked by server policy: Conversation ID [${blockedId}] is strictly confidential and excluded from GapGPT delegation.`,
            type: 'delegation_forbidden',
            code: 'conversation_excluded',
            excluded_id: blockedId
          }
        });
      }

      // Intercept Open WebUI background utility tasks (Title, Tags, Follow-ups) to prevent creating extra GapGPT sessions and burning quota
      const internalResult = handleInternalTask(body);
      if (internalResult !== null) {
        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          const chatId = `chatcmpl-${Date.now()}`;
          const chunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [{ index: 0, delta: { content: internalResult }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          const doneChunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        } else {
          return sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'claude-opus',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: internalResult },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          });
        }
      }

      const messages = body.messages || [];
      const model = body.model || 'claude-opus';

      // Parse multimodal messages (extract text and image_url) with Smart Context Window
      // GapGPT has a single-turn token/character limit (~25,000 chars). When conversations
      // accumulate multiple massive scripts (80,000+ chars), we must prune older turns while
      // strictly preserving the system prompt and the latest user prompt.
      const images = [];
      const parsedMessages = [];

      for (const m of messages) {
        const role = m.role || 'user';
        let textContent = '';
        if (typeof m.content === 'string') {
          textContent = m.content;
        } else if (Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.type === 'text' && part.text) {
              textContent += (textContent ? '\n' : '') + part.text;
            } else if (part.type === 'image_url') {
              const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
              if (url) images.push(url);
            }
          }
        }
        if (textContent.trim()) {
          parsedMessages.push({ role, content: textContent.trim() });
        }
      }

      // Context Window Budget: 22,000 characters total for GapGPT single-turn prompt
      const MAX_CONTEXT_CHARS = 22000;
      let prompt = '';

      if (parsedMessages.length <= 1) {
        prompt = parsedMessages.map(m => `${m.role}: ${m.content}`).join('\n\n');
      } else {
        const lastMsg = parsedMessages[parsedMessages.length - 1];
        const lastFormatted = `${lastMsg.role}: ${lastMsg.content}`;
        
        let remainingBudget = MAX_CONTEXT_CHARS - lastFormatted.length;
        const historyParts = [];

        // Check for system prompt at the beginning
        let systemPart = '';
        let startIndex = 0;
        if (parsedMessages[0].role === 'system') {
          systemPart = `system: ${parsedMessages[0].content}`;
          remainingBudget -= systemPart.length;
          startIndex = 1;
        }

        // Walk backwards from second-to-last message to fill remaining budget
        const reversedHistory = [];
        for (let i = parsedMessages.length - 2; i >= startIndex; i--) {
          const item = parsedMessages[i];
          let itemText = item.content;
          // If a single historical response is massive (e.g. 20KB code), trim the middle to save context
          if (itemText.length > 3500) {
            itemText = itemText.slice(0, 1500) + '\n\n... [محتوای میانی برای بهینه‌سازی طول کانتکست خلاصه شد] ...\n\n' + itemText.slice(-1500);
          }
          const formatted = `${item.role}: ${itemText}`;
          if (formatted.length <= remainingBudget) {
            reversedHistory.push(formatted);
            remainingBudget -= formatted.length;
          } else if (remainingBudget > 500) {
            // Include tail of the message that fits
            reversedHistory.push(`${item.role}: ... ` + formatted.slice(-remainingBudget));
            remainingBudget = 0;
            break;
          } else {
            break;
          }
        }

        reversedHistory.reverse();
        const allParts = [];
        if (systemPart) allParts.push(systemPart);
        allParts.push(...reversedHistory);
        allParts.push(lastFormatted);
        prompt = allParts.join('\n\n');
      }

      if (!prompt.trim() && images.length === 0) {
        prompt = 'Analyze the attached image(s)';
      }

      if (!prompt.trim() && images.length === 0) {
        return sendJson(res, 400, { error: 'No prompt, messages, or images provided' });
      }

      // Extract effort preference
      const requestedEffort = body.reasoning_effort || body.effort || body.metadata?.params?.reasoning_effort || undefined;

      // Extract conversation key for thread continuity
      const convKey = extractConversationKey(req, body);
      const existingGapChatToken = convKey ? chatSessionMap.get(convKey) : null;

      // When continuing an existing thread, GapGPT's database already has the entire prior history!
      // Sending only the latest turn prevents token limits and prevents context chopping.
      let promptToSend = prompt;
      let targetChatId = '';
      if (existingGapChatToken && parsedMessages.length > 1) {
        targetChatId = existingGapChatToken;
        const lastMsg = parsedMessages[parsedMessages.length - 1];
        let latestText = lastMsg ? lastMsg.content : prompt;
        if (parsedMessages[0].role === 'system' && parsedMessages.length > 2) {
          latestText = `system: ${parsedMessages[0].content}\n\n${latestText}`;
        }
        promptToSend = latestText;
        console.log(`🔗 [CONTINUITY] Continuing thread [${convKey}] via GapGPT chat [${targetChatId}] with latest turn (${promptToSend.length} chars)`);
      }

      // Handle Streaming (SSE)
      if (body.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*'
        });

        const chatId = `chatcmpl-${Date.now()}`;
        // Heartbeat keep-alive ping every 5 seconds to prevent proxy / client idle timeout
        const pingInterval = setInterval(() => {
          if (!res.writableEnded) {
            res.write(': ping\n\n');
          }
        }, 5000);

        try {
          let result;
          try {
            result = await askGapChat({
              prompt: promptToSend,
              model,
              effort: requestedEffort,
              chatId: targetChatId,
              images,
              onChunk: (chunkText) => {
                if (res.writableEnded) return;
                const chunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunkText },
                      finish_reason: null
                    }
                  ]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            });
          } catch (streamAttemptErr) {
            if (targetChatId) {
              console.warn(`⚠️ [CONTINUITY-FALLBACK] Chat continuity failed for [${targetChatId}] (${streamAttemptErr.message}). Retrying as fresh chat with full context...`);
              if (convKey) {
                chatSessionMap.delete(convKey);
                saveSessionStore();
              }
              result = await askGapChat({
                prompt,
                model,
                effort: requestedEffort,
                chatId: '',
                images,
                onChunk: (chunkText) => {
                  if (res.writableEnded) return;
                  const chunk = {
                    id: chatId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: chunkText },
                        finish_reason: null
                      }
                    ]
                  };
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
              });
            } else {
              throw streamAttemptErr;
            }
          }

          clearInterval(pingInterval);

          if (result && result.conversation_id && convKey) {
            chatSessionMap.set(convKey, result.conversation_id);
            saveSessionStore();
          }

          if (!res.writableEnded && (result?.status === 'quota_exceeded' || result?.is_limit_error)) {
            const quotaWarning = `⚠️ **محدودیت سهمیه ۳ ساعته GapGPT:**\n\n${result.message || 'سقف پیام‌های این بازه در GapGPT تکمیل شده است.'}\n\n${result.next_reset_time ? `زمان بازنشانی و شروع مجدد: **${result.next_reset_time}**` : ''}`;
            const warnChunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, delta: { content: quotaWarning }, finish_reason: null }]
            };
            res.write(`data: ${JSON.stringify(warnChunk)}\n\n`);
          }

          if (!res.writableEnded && result && result.incomplete) {
            const warn = {
              id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
              choices: [{ index: 0, delta: { content: `\n\n> ⚠️ پاسخ کامل از GapGPT دریافت نشد. متن کامل در گفتگوی GapGPT موجود است: https://gapgpt.app/chat/${result.conversation_id || ''}` }, finish_reason: null }]
            };
            res.write(`data: ${JSON.stringify(warn)}\n\n`);
          }

          if (!res.writableEnded) {
            const doneChunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: result.model || model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }
              ]
            };
            res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
          }
        } catch (streamErr) {
          clearInterval(pingInterval);
          if (!res.writableEnded) {
            const errChunk = {
              error: {
                message: streamErr.message,
                type: 'server_error',
                code: 'stream_error'
              }
            };
            res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
            return res.end();
          }
        }
        return;
      }

      // Non-streaming response
      let result;
      try {
        result = await askGapChat({
          prompt: promptToSend,
          model,
          effort: requestedEffort,
          chatId: targetChatId,
          images
        });
      } catch (nonStreamAttemptErr) {
        if (targetChatId) {
          console.warn(`⚠️ [CONTINUITY-FALLBACK] Non-streaming chat continuity failed for [${targetChatId}] (${nonStreamAttemptErr.message}). Retrying as fresh chat...`);
          if (convKey) {
            chatSessionMap.delete(convKey);
            saveSessionStore();
          }
          result = await askGapChat({
            prompt,
            model,
            effort: requestedEffort,
            chatId: '',
            images
          });
        } else {
          throw nonStreamAttemptErr;
        }
      }

      if (result && result.conversation_id && convKey) {
        chatSessionMap.set(convKey, result.conversation_id);
        saveSessionStore();
      }

      if (result && (result.status === 'quota_exceeded' || result.is_limit_error) && !result.response) {
        result.response = `⚠️ **محدودیت سهمیه ۳ ساعته GapGPT:**\n\n${result.message || 'سقف پیام‌های این بازه در GapGPT تکمیل شده است.'}\n\n${result.next_reset_time ? `زمان بازنشانی و شروع مجدد: **${result.next_reset_time}**` : ''}`;
      }

      return sendJson(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model || model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.response || ''
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        gapgpt_meta: {
          conversation_id: result.conversation_id,
          effort: result.effort,
          images_count: images.length,
          fallback_used: result.fallback_used || false
        }
      });
    }

        // Models list (/v1/models) - Full 55 models suite including Gemini 4 Argon & Claude Haiku 5.5
    if (pathname === '/v1/models' && req.method === 'GET') {
      return sendJson(res, 200, {
        object: 'list',
        data: [
          // 1. Google Gemini Suite
          { id: 'gemini-4-argon', object: 'model', name: 'Gemini 4 Argon (پیشرفته‌ترین مدل استدلالی گوگل)' },
          { id: 'gemini-3.8-flash', object: 'model', name: 'Gemini 3.8 Flash (جدیدترین مدل Flash گوگل)' },
          { id: 'gemini-3.5-flash-lite', object: 'model', name: 'Gemini 3.5 Flash Lite (مدل سبک و سریع گوگل)' },
          { id: 'gemini-2.5-pro', object: 'model', name: 'Gemini 2.5 Pro (مدل پرو جمنای ۲.۵ گوگل)' },
          { id: 'gemini-omni', object: 'model', name: 'Gemini Omni (تولید ویدئو از متن و تصویر گوگل)' },
          { id: 'gemini', object: 'model', name: 'Google Gemini (Auto - پاسخ سریع و دقیق)' },
          { id: 'gemini-2.0-flash', object: 'model', name: 'Google Gemini 2.0 Flash (Fast Multimodal)' },
          { id: 'gemini-1.5-pro', object: 'model', name: 'Google Gemini 1.5 Pro' },
          { id: 'gemini-1.5-flash', object: 'model', name: 'Google Gemini 1.5 Flash' },
          { id: 'gemini-1.5-flash-8b', object: 'model', name: 'Google Gemini 1.5 Flash 8B' },
          { id: 'gemini-pro', object: 'model', name: 'Google Gemini Pro' },
          { id: 'gemini-flash', object: 'model', name: 'Google Gemini Flash' },

          // 2. Anthropic Claude Suite
          { id: 'claude-haiku-5-5', object: 'model', name: 'Claude Haiku 5.5 (مدل سبک و سریع Anthropic)' },
          { id: 'claude-haiku', object: 'model', name: 'Claude Haiku 5.5 (Fast & Lightweight)' },
          { id: 'claude-4-6-sonnet', object: 'model', name: 'Claude 4.6 Sonnet (جدیدترین مدل Sonnet 4.6)' },
          { id: 'claude-sonnet-5-5', object: 'model', name: 'Claude Sonnet 5.5 (جدیدترین مدل Sonnet 5.5)' },
          { id: 'claude-sonnet', object: 'model', name: 'Claude Sonnet 5.5 (Anthropic)' },
          { id: 'claude-opus-5-5', object: 'model', name: 'Claude Opus 5.5 (Master Reasoning & Coding)' },
          { id: 'claude-opus', object: 'model', name: 'Claude Opus 5.5 (Anthropic)' },
          { id: 'claude-fable-5-1', object: 'model', name: 'Claude Fable 5.1 (تولید محتوای خلاقانه)' },
          { id: 'claude-fable-5', object: 'model', name: 'Claude Fable 5.1' },
          { id: 'claude-fable', object: 'model', name: 'Claude Fable (Creative & Writing)' },
          { id: 'claude', object: 'model', name: 'Claude (Auto - انتخاب هوشمند بین Sonnet, Opus و Fable)' },
          { id: 'claude-3-5-sonnet', object: 'model', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku', object: 'model', name: 'Claude 3.5 Haiku' },

          // 3. OpenAI GPT & Reasoning Suite
          { id: 'gpt-6-astra', object: 'model', name: 'GPT-6 Astra (Flagship Coding & Execution)' },
          { id: 'gpt-6.1-sol', object: 'model', name: 'GPT-6.1 Sol (استدلال و برنامه‌نویسی OpenAI)' },
          { id: 'gpt-6.1-terra', object: 'model', name: 'GPT-6.1 Terra (مدل متعادل خانواده GPT-6)' },
          { id: 'gpt-6-luna', object: 'model', name: 'GPT-6 Luna (سریع و مقرون‌به‌صرفه)' },
          { id: 'gpt-5.4-pro', object: 'model', name: 'GPT-5.4 Pro (نسخه پیشرفته برای کاربران حرفه‌ای)' },
          { id: 'o1', object: 'model', name: 'OpenAI o1 (Deep Deliberate Reasoning)' },
          { id: 'o1-mini', object: 'model', name: 'OpenAI o1-mini (STEM & Fast Reasoning)' },
          { id: 'o3', object: 'model', name: 'OpenAI o3 (Advanced Multi-Step Thinking)' },
          { id: 'o3-mini', object: 'model', name: 'OpenAI o3-mini (High-Speed Reasoning)' },
          { id: 'gpt-4o', object: 'model', name: 'OpenAI GPT-4o (Omni Multimodal)' },
          { id: 'gpt-4o-mini', object: 'model', name: 'OpenAI GPT-4o Mini' },
          { id: 'gpt-4-turbo', object: 'model', name: 'OpenAI GPT-4 Turbo' },
          { id: 'chatgpt', object: 'model', name: 'ChatGPT 4o (Standard)' },

          // 4. DeepSeek Suite
          { id: 'deepseek-r1', object: 'model', name: 'DeepSeek R1 (Open Reasoning Benchmark)' },
          { id: 'deepseek-v3', object: 'model', name: 'DeepSeek V3 (General Flagship)' },
          { id: 'deepseek', object: 'model', name: 'DeepSeek Auto (Intelligent Routing)' },
          { id: 'deepseek-v4.1-flash', object: 'model', name: 'DeepSeek V4.1 Flash' },
          { id: 'deepseek-coder', object: 'model', name: 'DeepSeek Coder' },

          // 5. xAI Grok Suite
          { id: 'grok-4.6', object: 'model', name: 'xAI Grok 4.6 (Next-Gen Intelligence)' },
          { id: 'grok-2', object: 'model', name: 'xAI Grok 2 (Realtime Knowledge)' },
          { id: 'grok', object: 'model', name: 'xAI Grok (Auto)' },
          { id: 'grok-vision', object: 'model', name: 'xAI Grok 2 Vision' },

          // 6. Alibaba Qwen Suite
          { id: 'qwen-3', object: 'model', name: 'Alibaba Qwen 3 (Multilingual & Code)' },
          { id: 'gapgpt-qwen-3.6', object: 'model', name: 'Alibaba Qwen 3.6' },
          { id: 'qwen-2.5', object: 'model', name: 'Alibaba Qwen 2.5' },
          { id: 'qwen-2.5-coder', object: 'model', name: 'Alibaba Qwen 2.5 Coder' },
          { id: 'qwen-plus', object: 'model', name: 'Alibaba Qwen Plus' },

          // 7. Perplexity Suite
          { id: 'perplexity', object: 'model', name: 'Perplexity Sonar (Online Search Intelligence)' },
          { id: 'sonar', object: 'model', name: 'Perplexity Sonar (Direct)' },
          { id: 'sonar-pro', object: 'model', name: 'Perplexity Sonar Pro (Deep Research)' },

          // 8. Other Specialized Models
          { id: 'kimi-3', object: 'model', name: 'Moonshot Kimi 3 (Long-Context Synthesis)' },
          { id: 'glm-5.3', object: 'model', name: 'Zhipu GLM 5.3 (Bilingual Technical Reasoning)' }
        ]
      });
    }

    return sendJson(res, 404, { error: `Not found: ${pathname}` });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GapGPT Bridge HTTP server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown: on SIGTERM/SIGINT (docker stop / compose up), finish all in-flight
// streams before exiting instead of being SIGKILLed mid-response.
const DRAIN_MAX_MS = Number(process.env.DRAIN_MAX_MS || 14 * 60 * 1000);
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 ${signal} received — draining ${activeRequests} in-flight request(s) (max ${DRAIN_MAX_MS / 1000}s)...`);
  server.close();
  const started = Date.now();
  const check = setInterval(() => {
    if (activeRequests <= 0 || Date.now() - started > DRAIN_MAX_MS) {
      clearInterval(check);
      console.log(`👋 Exiting (remaining in-flight: ${Math.max(activeRequests, 0)})`);
      process.exit(0);
    }
  }, 1000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
