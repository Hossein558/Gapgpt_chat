import { getAccessToken } from './gap_chat.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const token = getAccessToken();
  const saturdayStart = new Date("2026-11-06T20:30:00Z"); // Saturday 00:00:00 Tehran time
  console.log("=================================================");
  console.log("🧹 GAPGPT WEEKLY CHAT CLEANUP TOOL (Resilient)");
  console.log("Target Range: Saturday (2026-11-07) to Now (2026-11-10)");
  console.log("=================================================");

  // 1. Collect candidate chats
  let url = "https://gapgpt.ir/api/v1/chat_list?limit=100";
  const targetChats = [];
  let page = 1;

  while (url) {
    process.stdout.write(`Fetching chat page ${page}... `);
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'GapGPT-Desktop',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      console.log(`Failed (HTTP ${resp.status})`);
      break;
    }

    const data = await resp.json();
    const results = data.results || [];
    console.log(`Got ${results.length} items.`);

    let reachedOlder = false;
    for (const c of results) {
      if (c.pinned) continue; // NEVER delete pinned chats
      const created = new Date(c.created_at);
      if (created >= saturdayStart) {
        targetChats.push(c);
      } else {
        reachedOlder = true;
      }
    }

    if (reachedOlder || !data.next) {
      break;
    }

    url = data.next;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nIdentified ${targetChats.length} unpinned chats remaining to delete.`);
  if (targetChats.length === 0) {
    console.log("✅ All target weekly chats are already deleted!");
    return;
  }

  // 2. Perform deletions with retry on 429
  let deletedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < targetChats.length; i++) {
    const chat = targetChats[i];
    const progress = `[${i + 1}/${targetChats.length}]`;
    let attempts = 0;

    while (attempts < 5) {
      attempts++;
      try {
        const delResp = await fetch(`https://gapgpt.ir/api/v1/delete_chat/${chat.token}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'GapGPT-Desktop'
          },
          body: JSON.stringify({ deleted: true })
        });

        if (delResp.status === 429) {
          process.stdout.write(`⏳ Rate limit hit at ${progress}. Waiting 3.5s...\n`);
          await new Promise(r => setTimeout(r, 3500));
          continue;
        }

        if (delResp.ok) {
          deletedCount++;
          process.stdout.write(`${progress} Deleted: "${(chat.title || '').slice(0, 30)}" (${chat.token.slice(0, 8)}...)\n`);
        } else {
          failedCount++;
          console.warn(`${progress} Failed to delete ${chat.token}: HTTP ${delResp.status}`);
        }
        break;
      } catch (err) {
        if (attempts >= 5) {
          failedCount++;
          console.warn(`${progress} Error deleting ${chat.token}: ${err.message}`);
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // Pacing between deletes
    await new Promise(r => setTimeout(r, 350));
  }

  // 3. Clean up local session_store.json
  const sessionFile = path.join(__dirname, 'session_store.json');
  if (fs.existsSync(sessionFile)) {
    try {
      const deletedTokens = new Set(targetChats.map(c => c.token));
      const sessions = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      let modified = false;
      for (const [key, gapToken] of Object.entries(sessions)) {
        if (deletedTokens.has(gapToken)) {
          delete sessions[key];
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(sessionFile, JSON.stringify(sessions, null, 2), 'utf-8');
        console.log("Cleaned deleted chats from session_store.json");
      }
    } catch {}
  }

  console.log("\n=================================================");
  console.log(`✅ Cleanup Finished: ${deletedCount} deleted, ${failedCount} failed.`);
  console.log("=================================================");
}

main().catch(console.error);
