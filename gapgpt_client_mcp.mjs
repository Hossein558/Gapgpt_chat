#!/usr/bin/env node
import readline from 'readline';

const BASE_URL = process.env.GAPGPT_BASE_URL || 'https://gapgpt.desktopcenter.ir';
const API_KEY = process.env.BRIDGE_API_KEY || 'gapgpt_live_sk_7f8d9b1a4c02';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id, code, message, data = null) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }) + '\n');
}

async function apiRequest(path, method = 'GET', body = null) {
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GapGPT HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

rl.on('line', async (line) => {
  if (!line.trim()) return;

  let request;
  try {
    request = JSON.parse(line);
  } catch (e) {
    return;
  }

  const { id, method, params } = request;

  if (method === 'initialize') {
    return sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'gapgpt-chat-cloud-client', version: '1.4.0' }
    });
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    if (method === 'ping') sendResponse(id, {});
    return;
  }

  if (method === 'tools/list') {
    return sendResponse(id, {
      tools: [
        {
          name: 'ask_gapgpt_chat',
          description: 'Delegate heavy reasoning, architecture review, or Multimodal / Vision image analysis to GapGPT Cloud (Claude Opus 5.5, Sonnet 5.5, GPT-6, DeepSeek) via https://gapgpt.desktopcenter.ir using free chat quota to save agent tokens. Supports reasoning effort levels and image inputs.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'The prompt or problem description to process.' },
              model: {
                type: 'string',
                enum: ['claude-opus', 'claude-sonnet', 'claude-fable', 'gpt-6-astra', 'gpt-terra', 'deepseek', 'gemini'],
                description: 'The model to use in Chat (default: claude-opus).'
              },
              effort: {
                type: 'string',
                enum: ['high', 'medium', 'low', 'deep', 'thoughtful', 'quick'],
                description: 'Reasoning effort level (default: high).'
              },
              images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional array of image URLs or base64 data URIs for vision analysis.'
              },
              conversation_id: { type: 'string', description: 'Optional conversation ID to continue a thread.' }
            },
            required: ['prompt']
          }
        },
        {
          name: 'get_gapgpt_quota',
          description: 'Check current GapGPT chat quota, 3-hour limits, and daily availability.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'get_gapgpt_auth_status',
          description: 'Check remaining token lifetime, issued date, expiry date, and days remaining before token expiration.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'renew_gapgpt_token',
          description: 'Trigger automated renewal of the GapGPT access token on the cloud server.',
          inputSchema: { type: 'object', properties: {} }
        }
      ]
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      if (name === 'ask_gapgpt_chat') {
        const data = await apiRequest('/ask', 'POST', {
          prompt: args.prompt,
          model: args.model || 'claude-opus',
          effort: args.effort || 'high',
          images: args.images || [],
          conversation_id: args.conversation_id || ''
        });
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } else if (name === 'get_gapgpt_quota') {
        const data = await apiRequest('/quota', 'GET');
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } else if (name === 'get_gapgpt_auth_status') {
        const data = await apiRequest('/auth/status', 'GET');
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } else if (name === 'renew_gapgpt_token') {
        const data = await apiRequest('/auth/renew', 'POST');
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } else {
        return sendError(id, -32601, `Unknown tool: ${name}`);
      }
    } catch (err) {
      return sendResponse(id, {
        isError: true,
        content: [{ type: 'text', text: `Error calling ${name}: ${err.message}` }]
      });
    }
  }

  sendError(id, -32601, `Method not found: ${method}`);
});
