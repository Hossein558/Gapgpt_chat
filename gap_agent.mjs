#!/usr/bin/env node
// gap_agent.mjs - Command-line interface for executeGapChatAgenticTask
import { executeGapChatAgenticTask } from './gapchat_agent.mjs';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
let task = '';
let workspace = process.cwd();
let explicitWorkspace = false;
let model = 'gpt-6-astra';
let effort = 'medium';
let maxTurns = 8;
let timeoutSeconds = 300;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--workspace' || arg === '-C' || arg === '-w') {
    workspace = path.resolve(args[++i]);
    explicitWorkspace = true;
  } else if (arg === '--model' || arg === '-m') {
    model = args[++i];
  } else if (arg === '--effort' || arg === '-e') {
    effort = args[++i];
  } else if (arg === '--max-turns') {
    maxTurns = parseInt(args[++i], 10);
  } else if (arg === '--timeout') {
    timeoutSeconds = parseInt(args[++i], 10);
  } else if (arg === '--json') {
    jsonOutput = true;
  } else if (!task) {
    task = arg;
  }
}

if (!task) {
  console.error('Usage: node gap_agent.mjs "<task>" [-C workspace] [-m model] [--json]');
  process.exit(1);
}

// Smart Workspace Auto-Detection: check if task starts with a directory path
if (!explicitWorkspace) {
  const candidateMatch = task.match(/^([a-zA-Z]:\\[^\t\r\n*?"<>|]+|\/[^\t\r\n*?"<>|]+)/);
  if (candidateMatch) {
    let candidate = candidateMatch[1].trim();
    while (candidate.length > 3) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        workspace = path.resolve(candidate);
        break;
      }
      const lastSpace = candidate.lastIndexOf(' ');
      if (lastSpace > 0) {
        candidate = candidate.slice(0, lastSpace).trim();
      } else {
        break;
      }
    }
  }
}

if (!jsonOutput) {
  console.log(`🤖 [GapChat Agentic Engine] Starting autonomous task...`);
  console.log(`📁 Workspace: ${workspace}`);
  console.log(`🧠 Model:     ${model} (${effort})`);
  console.log(`----------------------------------------------------------------`);
}

executeGapChatAgenticTask({
  task,
  workspace,
  model,
  effort,
  maxTurns,
  timeoutSeconds,
  onTurnUpdate: (update) => {
    if (!jsonOutput) {
      if (update.status === 'requesting_model') {
        console.log(`⏳ [Turn ${update.turn}/${update.maxTurns}] Consulting model for next action...`);
      } else if (update.status === 'running_command') {
        console.log(`⚡ [Turn ${update.turn}] Executing: ${update.command}`);
      }
    }
  }
}).then(res => {
  if (jsonOutput) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`----------------------------------------------------------------`);
    if (res.status === 'succeeded') {
      console.log(`✅ [Task Succeeded in ${res.turns_used} turn(s)!]`);
    } else {
      console.log(`⚠️ [Task Finished with status: ${res.status}]`);
    }
    console.log(`📝 Modified Files: ${res.modified_files.join(', ') || 'None'}`);
    console.log(`💡 Quota Used:     ${res.quota_type}`);
    console.log(`📋 Summary:\n${res.summary}`);
  }
  process.exit(res.status === 'succeeded' ? 0 : 1);
}).catch(err => {
  console.error(`❌ Agent Error: ${err.message}`);
  process.exit(1);
});
