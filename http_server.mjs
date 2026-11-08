import http from 'http';
import {
  askGapChat,
  getQuota,
  listRecentChats,
  getChatHistory,
  getTokenExpiryInfo,
  refreshAccessToken,
  checkAndAutoRenewToken
} from './gap_chat.mjs';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const BRIDGE_API_KEY = (process.env.BRIDGE_API_KEY || '').trim();

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

const server = http.createServer(async (req, res) => {
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
      version: '1.4.0',
      auth_enabled: !!BRIDGE_API_KEY,
      features: ['openai-compatible', 'streaming-sse', 'multimodal-vision', 'auto-token-renew'],
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

    // Direct Ask endpoint (Supports prompt and images array)
    if (pathname === '/ask' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { prompt, model, effort, conversation_id, images } = body;
      if (!prompt && (!images || images.length === 0)) {
        return sendJson(res, 400, { error: 'Missing required field: prompt or images' });
      }
      const result = await askGapChat({
        prompt: prompt || 'Analyze this image',
        model: model || 'claude-opus',
        effort: effort || 'high',
        chatId: conversation_id || '',
        images: images || []
      });
      return sendJson(res, 200, result);
    }

    // OpenAI-compatible Chat Completions (/v1/chat/completions with Multimodal / Vision)
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const messages = body.messages || [];
      const model = body.model || 'claude-opus';

      // Parse multimodal messages (extract text and image_url)
      const promptParts = [];
      const images = [];

      for (const m of messages) {
        const role = m.role || 'user';
        if (typeof m.content === 'string') {
          promptParts.push(`${role}: ${m.content}`);
        } else if (Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.type === 'text' && part.text) {
              promptParts.push(`${role}: ${part.text}`);
            } else if (part.type === 'image_url') {
              const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
              if (url) images.push(url);
            }
          }
        }
      }

      const prompt = promptParts.join('\n\n') || (images.length > 0 ? 'Analyze the attached image(s)' : '');

      if (!prompt.trim() && images.length === 0) {
        return sendJson(res, 400, { error: 'No prompt, messages, or images provided' });
      }

      // Handle Streaming (SSE)
      if (body.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*'
        });

        const chatId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        const onChunk = (text) => {
          const chunkPayload = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: { content: text },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
        };

        try {
          const result = await askGapChat({
            prompt,
            model,
            effort: 'high',
            images,
            onChunk
          });

          const stopPayload = {
            id: chatId,
            object: 'chat.completion.chunk',
            created: created,
            model: result.model || model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }
            ]
          };
          res.write(`data: ${JSON.stringify(stopPayload)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        } catch (err) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          return res.end();
        }
      }

      // Non-streaming response
      const result = await askGapChat({
        prompt,
        model,
        effort: 'high',
        images
      });

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

    // Models list (/v1/models)
    if (pathname === '/v1/models' && req.method === 'GET') {
      return sendJson(res, 200, {
        object: 'list',
        data: [
          { id: 'claude-opus', object: 'model', name: 'Claude Opus 5.5 (Vision & Deep Reasoning)' },
          { id: 'claude-sonnet', object: 'model', name: 'Claude Sonnet 5.5 (Vision)' },
          { id: 'claude-fable', object: 'model', name: 'Claude Fable 5' },
          { id: 'gpt-6-astra', object: 'model', name: 'GPT-6 Astra (Vision)' },
          { id: 'gpt-terra', object: 'model', name: 'GPT-6.1 Terra' },
          { id: 'deepseek', object: 'model', name: 'DeepSeek' }
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
