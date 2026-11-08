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

export function getAccessToken() {
  const res = spawnSync(PYTHON_PATH, [path.join(__dirname, 'auth.py')]);
  if (res.status !== 0) {
    throw new Error('Failed to retrieve GapGPT access token: ' + res.stderr.toString());
  }
  return res.stdout.toString().trim().split('\n').pop().trim();
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
function executeSocketQuery({ prompt, modelConfig, effortConfig, chatId, onChunk, timeoutMs }) {
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
      const finalText = (fullResponse || streamText).trim();
      if (!finalText) return;

      resolved = true;
      cleanup();
      resolve({
        status: 'ok',
        conversation_id: targetChatToken,
        message_token: targetMessageToken,
        model: modelConfig.name,
        effort: effortConfig.label,
        messages_remaining: messagesRemaining,
        response: finalText,
        reasoning: reasoning.trim()
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
        file_tokens: [],
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
  autoFallback = true,
  onChunk = null,
  timeoutMs = 120000
}) {
  const primaryModelConfig = resolveModel(model);
  const effortConfig = resolveEffort(effort);

  // Fallback candidate chain
  const fallbackCandidates = ['claude-sonnet', 'deepseek'];

  // Attempt primary
  try {
    const res = await executeSocketQuery({
      prompt,
      modelConfig: primaryModelConfig,
      effortConfig,
      chatId,
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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' || args[i] === '-p') {
      prompt = args[++i];
    } else if (args[i] === '--model' || args[i] === '-m') {
      model = args[++i];
    } else if (args[i] === '--effort' || args[i] === '-e') {
      effort = args[++i];
    } else if (args[i] === '--chat-id' || args[i] === '-c') {
      chatId = args[++i];
    } else if (args[i] === '--json') {
      isJson = true;
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

  if (prompt) {
    let printedStream = false;
    askGapChat({
      prompt,
      model,
      effort,
      chatId,
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
