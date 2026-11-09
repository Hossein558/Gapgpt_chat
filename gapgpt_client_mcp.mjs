#!/usr/bin/env node
import readline from 'readline';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.GAPGPT_BASE_URL || 'https://gapgpt.desktopcenter.ir';
const API_KEY = process.env.BRIDGE_API_KEY || 'gapgpt_live_sk_7f8d9b1a4c02';

// Confidential Conversation IDs (Exclusion List)
const EXCLUSIONS_FILE = path.join(__dirname, 'exclusions.json');
const GLOBAL_EXCLUSIONS_FILE = '/root/.gemini/config/gapgpt_excluded_conversations.json';
let defaultExcludedIds = [
  '5e07464b-76f3-42d5-a404-68b6a7e6b7cc',
  '388ebb05-83bc-4615-a0d3-0168772d3efe',
  '54ac95a2-6fc0-41aa-99b2-8140e915fc36',
  'ea524caf-adbb-44c0-b054-5f204b5cb7c0'
];

function getExcludedConversationIds() {
  const ids = [...defaultExcludedIds];
  const candidates = [EXCLUSIONS_FILE, GLOBAL_EXCLUSIONS_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (Array.isArray(data.excluded_conversation_ids)) {
          for (const id of data.excluded_conversation_ids) {
            if (!ids.includes(id)) ids.push(id);
          }
        }
      }
    } catch (e) {}
  }
  return ids;
}

function checkExclusion(payload) {
  const excluded = getExcludedConversationIds();

  // 1. Check direct payload
  if (payload) {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const id of excluded) {
      if (str.includes(id)) {
        return id;
      }
    }
  }

  // 2. Check Antigravity process environment variables
  const envConvId = process.env.ANTIGRAVITY_CONVERSATION_ID;
  if (envConvId && excluded.includes(envConvId.trim())) {
    return envConvId.trim();
  }

  if (process.env.ANTIGRAVITY_SOURCE_METADATA) {
    for (const id of excluded) {
      if (process.env.ANTIGRAVITY_SOURCE_METADATA.includes(id)) {
        return id;
      }
    }
  }

  return null;
}

function addExcludedId(newId) {
  const cleanId = (newId || '').trim();
  if (!cleanId) return getExcludedConversationIds();
  const current = getExcludedConversationIds();
  if (!current.includes(cleanId)) {
    current.push(cleanId);
    const content = JSON.stringify({
      description: "List of confidential Antigravity Conversation IDs that are strictly forbidden from being delegated or sent to GapGPT.",
      excluded_conversation_ids: current
    }, null, 2);
    for (const f of [EXCLUSIONS_FILE, GLOBAL_EXCLUSIONS_FILE]) {
      try {
        fs.writeFileSync(f, content, 'utf-8');
      } catch (e) {}
    }
  }
  return current;
}

function getGapCodeBinary() {
  if (process.env.GAPCODE_BIN && fs.existsSync(process.env.GAPCODE_BIN)) {
    return process.env.GAPCODE_BIN;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
    const bundled = path.join(localAppData, 'Programs', 'GapGPT', 'resources', 'bin', 'gapcode.exe');
    if (fs.existsSync(bundled)) return bundled;
    const standalone = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.gapcode', 'packages', 'standalone', 'releases', '0.164.3-x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    if (fs.existsSync(standalone)) return standalone;
  } else {
    const paths = [
      '/root/.gapcode/packages/app-server-daemon/releases/0.161.0-x86_64-unknown-linux-musl/bin/codex',
      '/usr/local/bin/gapcode',
      '/usr/bin/gapcode'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return 'gapcode';
}

function executeGapCodeTask({ task, workspace, model = 'gpt-6-astra', timeoutSeconds = 300, bypassSandbox = true }) {
  return new Promise((resolve, reject) => {
    const binPath = getGapCodeBinary();
    const ws = workspace ? path.resolve(workspace) : process.cwd();

    if (!fs.existsSync(ws)) {
      try {
        fs.mkdirSync(ws, { recursive: true });
      } catch (e) {
        return reject(new Error(`Workspace path does not exist and could not be created: ${ws}`));
      }
    }

    const args = [
      'exec',
      task,
      '-C', ws,
      '--skip-git-repo-check',
      '-m', model || 'gpt-6-astra'
    ];

    if (bypassSandbox) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--approve-for-me');
    }

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    let child;
    try {
      child = spawn(binPath, args, {
        cwd: ws,
        env: process.env,
        shell: false
      });
    } catch (err) {
      return reject(new Error(`Failed to launch GapCode binary (${binPath}): ${err.message}`));
    }

    child.stdin.end('');

    child.stdout.on('data', data => { stdout += data.toString('utf-8'); });
    child.stderr.on('data', data => { stderr += data.toString('utf-8'); });

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      reject(new Error(`GapCode task timed out after ${timeoutSeconds} seconds`));
    }, timeoutSeconds * 1000);

    child.on('close', code => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      
      let tokensUsed = null;
      const tokenMatch = stdout.match(/tokens used\s*([\d,]+)/i) || stderr.match(/tokens used\s*([\d,]+)/i);
      if (tokenMatch) {
        tokensUsed = parseInt(tokenMatch[1].replace(/,/g, ''), 10);
      }

      if (code === 0) {
        resolve({
          status: 'completed',
          workspace: ws,
          model: model || 'gpt-6-astra',
          duration_ms: durationMs,
          tokens_used: tokensUsed,
          output: stdout.trim(),
          details: stderr.trim()
        });
      } else {
        resolve({
          status: 'failed',
          exit_code: code,
          workspace: ws,
          model: model || 'gpt-6-astra',
          duration_ms: durationMs,
          output: stdout.trim(),
          error: stderr.trim()
        });
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`Error executing GapCode: ${err.message}`));
    });
  });
}

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
      serverInfo: { name: 'gapgpt-dual-engine-mcp', version: '1.5.0' }
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
          description: '[GapChat Engine] Delegate deep reasoning, architecture planning, code review, or Multimodal / Vision image analysis to GapGPT Chat (Claude Opus 5.5, Sonnet 5.5, GPT-6, DeepSeek) via https://gapgpt.desktopcenter.ir using free 3-hour chat quota (300 msgs / 3h). Strictly blocked for confidential excluded conversation IDs.',
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
          name: 'run_gapcode_task',
          description: '[GapCode Engine] Delegate an AUTONOMOUS EXECUTION task directly to GapCode. GapCode independently enters the workspace directory, reads/edits code files, runs shell/terminal commands, performs builds, and resolves errors without manual intervention. Strictly blocked for confidential excluded conversation IDs.',
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The full actionable task description or instructions for GapCode to execute.'
              },
              workspace: {
                type: 'string',
                description: 'Working directory path where GapCode should read/write files and run commands. Defaults to current directory.'
              },
              model: {
                type: 'string',
                enum: ['gpt-6-astra', 'claude-opus-4-8', 'gpt-6.1-terra', 'deepseek-v4.1-flash', 'kimi-for-coding', 'gapgpt-qwen-thinking'],
                description: 'Model to use for task execution. Default is "gpt-6-astra".'
              },
              timeout_seconds: {
                type: 'number',
                description: 'Maximum execution timeout in seconds (default: 300).'
              },
              dangerously_bypass_sandbox: {
                type: 'boolean',
                description: 'Whether to allow automatic shell execution without interactive confirmation prompts (default: true).'
              }
            },
            required: ['task']
          }
        },
        {
          name: 'manage_gapgpt_exclusions',
          description: 'Check or add confidential Antigravity Conversation IDs to the exclusion blacklist. Excluded IDs are strictly blocked from being sent or delegated to GapGPT.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'add'],
                description: 'Action to perform: "list" to view excluded IDs, or "add" to add a new ID.'
              },
              conversation_id: {
                type: 'string',
                description: 'The Conversation ID to add (required if action is "add").'
              }
            },
            required: ['action']
          }
        },
        {
          name: 'get_gapgpt_quota',
          description: 'Check current GapGPT chat quota, 3-hour limits, and daily availability.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'get_gapgpt_auth_status',
          description: 'Check remaining token lifetime, issued date, expiry date, and days remaining before token expiration on GapGPT Cloud.',
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
        // Enforce Exclusion Firewall Check
        const blockedId = checkExclusion(args.prompt) || checkExclusion(args.conversation_id);
        if (blockedId) {
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'blocked',
                delegation_blocked: true,
                excluded_conversation_id: blockedId,
                message: `⛔ DELEGATION BLOCKED BY POLICY: Conversation ID [${blockedId}] is on the strict internal-only exclusion list. Do not delegate this task to GapGPT; you MUST process it directly within Antigravity using internal models.`
              }, null, 2)
            }]
          });
        }

        const data = await apiRequest('/ask', 'POST', {
          prompt: args.prompt,
          model: args.model || 'claude-opus',
          effort: args.effort || 'high',
          images: args.images || [],
          conversation_id: args.conversation_id || ''
        });
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } else if (name === 'run_gapcode_task') {
        // Enforce Exclusion Firewall Check
        const blockedId = checkExclusion(args.task) || checkExclusion(args.workspace);
        if (blockedId) {
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'blocked',
                delegation_blocked: true,
                excluded_conversation_id: blockedId,
                message: `⛔ TASK EXECUTION BLOCKED BY POLICY: Conversation ID [${blockedId}] is on the strict internal-only exclusion list. Do not delegate this task to GapCode; you MUST process it directly within Antigravity.`
              }, null, 2)
            }]
          });
        }

        const result = await executeGapCodeTask({
          task: args.task,
          workspace: args.workspace,
          model: args.model || 'gpt-6-astra',
          timeoutSeconds: args.timeout_seconds || 300,
          bypassSandbox: args.dangerously_bypass_sandbox !== false
        });
        return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } else if (name === 'manage_gapgpt_exclusions') {
        const action = args.action || 'list';
        if (action === 'add') {
          const updated = addExcludedId(args.conversation_id);
          // Try to sync with server
          try {
            await apiRequest('/exclusions', 'POST', { conversation_id: args.conversation_id });
          } catch (e) {}
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `Conversation ID [${args.conversation_id}] added to exclusion blacklist`,
                excluded_conversation_ids: updated
              }, null, 2)
            }]
          });
        } else {
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                excluded_conversation_ids: getExcludedConversationIds()
              }, null, 2)
            }]
          });
        }
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
