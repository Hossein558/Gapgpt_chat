import readline from 'readline';
import {
  askGapChat,
  getChatHistory,
  listRecentChats,
  getQuota,
  resolveModel,
  getTokenExpiryInfo,
  refreshAccessToken
} from './gap_chat.mjs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result) {
  const message = {
    jsonrpc: '2.0',
    id: id,
    result: result
  };
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendError(id, code, message, data = null) {
  const response = {
    jsonrpc: '2.0',
    id: id,
    error: {
      code: code,
      message: message,
      ...(data ? { data } : {})
    }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
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
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'gapgpt-chat-bridge',
        version: '1.4.0'
      }
    });
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    return sendResponse(id, {
      tools: [
        {
          name: 'get_gapgpt_auth_status',
          description: 'Check the remaining lifetime and expiration date of your GapGPT authentication token.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'renew_gapgpt_token',
          description: 'Trigger automated renewal of the GapGPT access token using the stored refresh token or credentials.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'ask_gapgpt_chat',
          description: 'Ask a question, analyze code, or process images (Multimodal / Vision) with GapGPT Chat (Claude Opus 5.5, Sonnet 5.5, GPT-6, DeepSeek) using your unused Chat subscription quota to save Agent tokens. Supports reasoning effort levels (high/deep, medium, low/fast) and image inputs (URLs or base64 data URIs).',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The question, prompt, or technical content to process in GapGPT Chat.'
              },
              model: {
                type: 'string',
                enum: ['claude-opus', 'claude-sonnet', 'claude-haiku-5-5', 'claude-4-6-sonnet', 'claude-fable-5-1', 'claude-haiku', 'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-omni', 'gemini', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.4-pro', 'deepseek', 'grok-4.6', 'qwen-3'],
                description: 'The model to use in Chat. Default is gpt-6-astra (GPT-6 Astra).'
              },
              effort: {
                type: 'string',
                enum: ['high', 'medium', 'low', 'deep', 'thoughtful', 'quick', 'عمیق', 'متفکر', 'سریع'],
                description: 'Reasoning effort level. Default is "high" (عمیق / Deep thinking for Claude Opus).'
              },
              images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional array of image URLs or base64 data URIs for Multimodal / Vision analysis.'
              },
              conversation_id: {
                type: 'string',
                description: 'Optional Conversation ID (chat_token) to continue the discussion in that thread.'
              },
              auto_fallback: {
                type: 'boolean',
                description: 'Whether to automatically fall back to Claude Sonnet or DeepSeek if Opus quota is exceeded. Default is true.'
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'get_gapgpt_quota',
          description: 'Check your current GapGPT Chat subscription status, rate limits, 3-hour limits, and daily quotas.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_gapgpt_chat_history',
          description: 'Retrieve the messages and conversation history from a GapGPT chat by its Conversation ID.',
          inputSchema: {
            type: 'object',
            properties: {
              conversation_id: {
                type: 'string',
                description: 'The Conversation ID (chat_token) to inspect.'
              }
            },
            required: ['conversation_id']
          }
        },
        {
          name: 'list_gapgpt_recent_chats',
          description: 'List recent chat conversations in your GapGPT account with their Conversation IDs and titles.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of recent chats to return (default 10).'
              }
            }
          }
        }
      ]
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      if (name === 'get_gapgpt_auth_status') {
        const info = getTokenExpiryInfo();
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info, null, 2)
            }
          ]
        });
      } else if (name === 'renew_gapgpt_token') {
        const ren = await refreshAccessToken();
        const info = getTokenExpiryInfo();
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'ok', renewal: ren, token_info: info }, null, 2)
            }
          ]
        });
      } else if (name === 'ask_gapgpt_chat') {
        const result = await askGapChat({
          prompt: args.prompt,
          model: args.model || 'gpt-6-astra',
          effort: args.effort || 'high',
          images: args.images || [],
          chatId: args.conversation_id || '',
          autoFallback: args.auto_fallback !== false
        });
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        });
      } else if (name === 'get_gapgpt_quota') {
        const quota = await getQuota();
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(quota, null, 2)
            }
          ]
        });
      } else if (name === 'get_gapgpt_chat_history') {
        const hist = await getChatHistory(args.conversation_id);
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(hist, null, 2)
            }
          ]
        });
      } else if (name === 'list_gapgpt_recent_chats') {
        const list = await listRecentChats(args.limit || 10);
        return sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(list, null, 2)
            }
          ]
        });
      } else {
        return sendError(id, -32601, `Unknown tool: ${name}`);
      }
    } catch (err) {
      return sendResponse(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${err.message}`
          }
        ]
      });
    }
  }

  if (method === 'ping') {
    return sendResponse(id, {});
  }

  sendError(id, -32601, `Method not found: ${method}`);
});
