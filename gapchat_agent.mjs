// gapchat_agent.mjs - Robust Chat-driven Agentic ReAct Engine
// Powers autonomous file editing, testing, and debugging using GapGPT free chat quota
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { askGapChat } from './gap_chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCLUSIONS_FILE = path.join(__dirname, 'exclusions.json');

function isConversationExcluded(conversationId) {
  if (!conversationId) return false;
  if (fs.existsSync(EXCLUSIONS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(EXCLUSIONS_FILE, 'utf-8'));
      const excluded = data.excluded_conversation_ids || [];
      if (excluded.includes(conversationId)) return true;
    } catch {}
  }
  return false;
}

// Ensure target file stays strictly inside workspace
function resolveSafePath(workspace, relativePath) {
  const resolved = path.resolve(workspace, relativePath);
  const normalizedWs = path.normalize(workspace);
  const normalizedTarget = path.normalize(resolved);
  
  // Case-insensitive check on Windows
  if (process.platform === 'win32') {
    if (!normalizedTarget.toLowerCase().startsWith(normalizedWs.toLowerCase())) {
      throw new Error(`Security Exception: Access denied outside workspace root (${relativePath})`);
    }
  } else {
    if (!normalizedTarget.startsWith(normalizedWs)) {
      throw new Error(`Security Exception: Access denied outside workspace root (${relativePath})`);
    }
  }
  return normalizedTarget;
}

// Action Parser
export function parseActions(text) {
  const actions = [];
  let completion = null;

  // 1. Completion Block
  const compMatch = text.match(/<<<COMPLETION>>>([\s\S]*?)<<<END_COMPLETION>>>/i) ||
                    text.match(/<<<DONE>>>([\s\S]*?)(?:<<<END_DONE>>>|$)/i);
  if (compMatch) {
    completion = compMatch[1].trim();
  }

  // 2. Action Blocks: <<<ACTION: type [param="val"]>>> content <<<END_ACTION>>>
  const actionRegex = /<<<ACTION:\s*([a-zA-Z0-9_-]+)(?:\s+([^>]*))?>>>([\s\S]*?)<<<END_ACTION>>>/gi;
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    const type = match[1].toLowerCase().trim();
    const paramsRaw = match[2] || '';
    const body = match[3];

    const params = {};
    const paramRegex = /([a-zA-Z0-9_-]+)=["']([^"']*)["']/g;
    let pm;
    while ((pm = paramRegex.exec(paramsRaw)) !== null) {
      params[pm[1]] = pm[2];
    }

    actions.push({
      type,
      params,
      content: body
    });
  }

  // 3. Fallback for legacy format: <<<FILE: path>>> code
  if (actions.length === 0) {
    const fileParts = text.split(/<<<FILE:\s*([^>]+)>>>/i);
    if (fileParts.length > 1) {
      for (let i = 1; i < fileParts.length; i += 2) {
        const filePath = fileParts[i].trim();
        let rawContent = fileParts[i + 1] || '';
        
        let cmd = null;
        if (rawContent.includes('<<<ACTION: RUN_COMMAND>>>')) {
          const splitParts = rawContent.split('<<<ACTION: RUN_COMMAND>>>');
          rawContent = splitParts[0];
          cmd = splitParts[1].trim();
        } else if (rawContent.includes('<<<COMMAND>>>')) {
          const splitParts = rawContent.split('<<<COMMAND>>>');
          rawContent = splitParts[0];
          cmd = splitParts[1].trim();
        }

        // Clean markdown backticks
        const codeMatch = rawContent.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```/);
        const cleanCode = codeMatch ? codeMatch[1] : rawContent.trim();

        actions.push({
          type: 'write_file',
          params: { path: filePath },
          content: cleanCode
        });

        if (cmd) {
          const cmdMatch = cmd.match(/```(?:bat|sh|bash|cmd|powershell)?\n([\s\S]*?)\n```/);
          actions.push({
            type: 'run_command',
            params: {},
            content: (cmdMatch ? cmdMatch[1] : cmd).replace(/<<<END_COMMAND>>>/g, '').trim()
          });
        }
      }
    }
  }

  return { actions, completion };
}

// Execute Shell Command inside Workspace
function executeCommand(commandStr, workspace, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/sh';
    const shellFlag = isWin ? '/c' : '-c';

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(shell, [shellFlag, commandStr], {
      cwd: workspace,
      env: process.env,
      shell: false
    });

    const timer = setTimeout(() => {
      killed = true;
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: killed ? -1 : (code ?? (signal ? 1 : 0)),
        signal: signal || null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs,
        timedOut: killed
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        signal: null,
        stdout: stdout.trim(),
        stderr: `Failed to spawn command: ${err.message}`,
        durationMs: Date.now() - startTime,
        timedOut: false
      });
    });
  });
}

/**
 * Execute an autonomous task using GapGPT Chat Quota (Zero Agentic Credit cost).
 */
export async function executeGapChatAgenticTask({
  task,
  workspace,
  model = 'gpt-6-astra',
  effort = 'medium',
  maxTurns = 5,
  timeoutSeconds = 300,
  commandTimeoutSeconds = 60,
  conversationId = null,
  onTurnUpdate = null
}) {
  const ws = workspace ? path.resolve(workspace) : process.cwd();
  if (!fs.existsSync(ws)) {
    fs.mkdirSync(ws, { recursive: true });
  }

  if (isConversationExcluded(conversationId)) {
    throw new Error(`Security Firewall: Conversation ID ${conversationId} is strictly excluded from GapGPT integration.`);
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const modifiedFiles = new Set();
  const executionLog = [];
  const deadline = Date.now() + (timeoutSeconds * 1000);

  let currentChatToken = '';
  let turnsUsed = 0;
  let finalSummary = '';
  let finalStatus = 'failed';

  // System Protocol Prompt
  const systemPrompt = `[ROLE: Autonomous System Coding Agent]
You are an autonomous engineering agent working in workspace: "${ws}".
You have full authority to read files, create/edit files, and run terminal commands to achieve the user's task.
All work uses the standard GapChat quota.

ACTION PROTOCOL:
Output your thought process, followed by one or more actionable blocks using this EXACT syntax:

1. To write or overwrite a file:
<<<ACTION: write_file path="relative/path/to/file">>>
full file content here
<<<END_ACTION>>>

2. To read an existing file:
<<<ACTION: read_file path="relative/path/to/file">>>
<<<END_ACTION>>>

3. To execute a terminal shell command (test, build, python, git, etc.):
<<<ACTION: run_command>>>
command to run
<<<END_ACTION>>>

4. When the task is 100% completed and verified by tests:
<<<COMPLETION>>>
Summary of changes made, tests passed, and final verification status.
<<<END_COMPLETION>>>

RULES:
- Do NOT output hypothetical examples; every action block will be executed immediately on disk.
- Prefer self-contained, high-quality implementations with automated tests.
- When you receive test or command results in the next turn, analyze errors and fix the files immediately.`;

  let currentPrompt = `${systemPrompt}\n\n[USER TASK]:\n${task}`;

  while (turnsUsed < maxTurns) {
    if (Date.now() > deadline) {
      finalStatus = 'timed_out';
      finalSummary = `Task timed out after ${timeoutSeconds} seconds.`;
      break;
    }

    turnsUsed++;
    if (onTurnUpdate) {
      onTurnUpdate({ turn: turnsUsed, maxTurns, status: 'requesting_model' });
    }

    let modelResponse;
    try {
      modelResponse = await askGapChat({
        prompt: currentPrompt,
        model: model,
        effort: effort,
        chatId: currentChatToken,
        timeoutMs: Math.min(90000, deadline - Date.now())
      });
      if (modelResponse.conversation_id) {
        currentChatToken = modelResponse.conversation_id;
      }
    } catch (err) {
      finalStatus = 'model_error';
      finalSummary = `GapChat model request failed on turn ${turnsUsed}: ${err.message}`;
      break;
    }

    const rawResponse = modelResponse.response || '';
    const { actions, completion } = parseActions(rawResponse);

    executionLog.push({
      turn: turnsUsed,
      rawResponseLength: rawResponse.length,
      actionsCount: actions.length,
      hasCompletion: !!completion
    });

    // Check if agent reported completion
    if (completion && actions.length === 0) {
      finalStatus = 'succeeded';
      finalSummary = completion;
      break;
    }

    // Execute actions sequentially
    const observations = [];
    let stopBatch = false;

    for (const act of actions) {
      if (stopBatch) break;

      if (act.type === 'write_file') {
        const relPath = act.params.path;
        if (!relPath) {
          observations.push(`[ERROR: write_file missing 'path' parameter]`);
          continue;
        }
        try {
          const absPath = resolveSafePath(ws, relPath);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, act.content, 'utf-8');
          modifiedFiles.add(relPath);
          observations.push(`[FILE WRITTEN: ${relPath} (${act.content.length} bytes)]`);
        } catch (e) {
          observations.push(`[ERROR WRITING ${relPath}: ${e.message}]`);
        }
      } else if (act.type === 'read_file') {
        const relPath = act.params.path;
        try {
          const absPath = resolveSafePath(ws, relPath);
          if (!fs.existsSync(absPath)) {
            observations.push(`[FILE NOT FOUND: ${relPath}]`);
          } else {
            const data = fs.readFileSync(absPath, 'utf-8');
            const truncated = data.length > 15000 ? data.slice(0, 15000) + '\n...[TRUNCATED]' : data;
            observations.push(`[CONTENT OF ${relPath}]:\n${truncated}`);
          }
        } catch (e) {
          observations.push(`[ERROR READING ${relPath}: ${e.message}]`);
        }
      } else if (act.type === 'run_command') {
        const cmd = act.content.trim();
        if (onTurnUpdate) {
          onTurnUpdate({ turn: turnsUsed, status: 'running_command', command: cmd });
        }
        const cmdRes = await executeCommand(cmd, ws, commandTimeoutSeconds * 1000);
        
        let obs = `[COMMAND EXECUTED: "${cmd}"]\nExit Code: ${cmdRes.exitCode}`;
        if (cmdRes.timedOut) {
          obs += ` (TIMED OUT after ${commandTimeoutSeconds}s)`;
        }
        if (cmdRes.stdout) {
          obs += `\nSTDOUT:\n${cmdRes.stdout.length > 8000 ? cmdRes.stdout.slice(-8000) : cmdRes.stdout}`;
        }
        if (cmdRes.stderr) {
          obs += `\nSTDERR:\n${cmdRes.stderr.length > 8000 ? cmdRes.stderr.slice(-8000) : cmdRes.stderr}`;
        }
        observations.push(obs);

        // If a test or command failed with non-zero, let the model analyze it immediately
        if (cmdRes.exitCode !== 0) {
          stopBatch = true;
        }
      }
    }

    if (completion) {
      finalStatus = 'succeeded';
      finalSummary = completion;
      break;
    }

    if (actions.length === 0) {
      // Model replied purely in text without action blocks
      currentPrompt = `[OBSERVATION: No valid action blocks were detected. Please provide executable actions using <<<ACTION: write_file path="...">>> ... <<<END_ACTION>>> or <<<ACTION: run_command>>> ... <<<END_ACTION>>>, or <<<COMPLETION>>> if finished.]`;
    } else {
      currentPrompt = `[OBSERVATION OF ACTIONS (Turn ${turnsUsed})]:\n${observations.join('\n\n')}\n\n[INSTRUCTION: Review observations. If errors occurred, fix files. If verified, output <<<COMPLETION>>>.]`;
    }
  }

  if (turnsUsed >= maxTurns && finalStatus !== 'succeeded') {
    finalStatus = 'turn_limit_reached';
    finalSummary = `Reached maximum turns limit (${maxTurns}) without verified completion.`;
  }

  return {
    run_id: runId,
    status: finalStatus,
    turns_used: turnsUsed,
    max_turns: maxTurns,
    model: model,
    workspace: ws,
    modified_files: Array.from(modifiedFiles),
    summary: finalSummary,
    conversation_id: currentChatToken,
    quota_type: 'GapChat Free Pro Quota (Zero Dollar Agentic Cost)'
  };
}
