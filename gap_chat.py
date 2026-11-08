#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import os
import subprocess
import argparse
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MJS_PATH = os.path.join(SCRIPT_DIR, "gap_chat.mjs")

def get_node_path():
    if os.environ.get("GAPGPT_NODE") and os.path.exists(os.environ["GAPGPT_NODE"]):
        return os.environ["GAPGPT_NODE"]
    local_app_data = os.environ.get("LOCALAPPDATA", os.path.expandvars(r"%USERPROFILE%\AppData\Local"))
    bundled = os.path.join(local_app_data, "Programs", "GapGPT", "resources", "bin", "node.exe")
    if os.path.exists(bundled):
        return bundled
    return "node"

NODE_PATH = get_node_path()

def main():
    parser = argparse.ArgumentParser(description="GapGPT Chat Bridge CLI")
    parser.add_argument("prompt", nargs="?", default="", help="Prompt to send to GapGPT chat")
    parser.add_argument("-p", "--prompt", dest="prompt_flag", default="", help="Prompt flag")
    parser.add_argument("-m", "--model", default="claude-opus", help="Model (claude-opus, claude-sonnet, gpt-6-astra, gpt-terra, deepseek)")
    parser.add_argument("-e", "--effort", default="high", choices=["high", "medium", "low", "deep", "thoughtful", "quick", "عمیق", "متفکر", "سریع"], help="Reasoning Effort: high/عمیق (default), medium/متفکر, low/سریع")
    parser.add_argument("-c", "--chat-id", default="", help="Conversation ID to continue")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("-s", "--status", action="store_true", help="Check active token expiry status")
    parser.add_argument("-q", "--quota", action="store_true", help="Check current subscription quota and rate limits")
    parser.add_argument("--list", type=int, nargs="?", const=10, help="List recent chats")
    parser.add_argument("--history", help="Retrieve conversation history by chat ID")
    parser.add_argument("--export-token", action="store_true", help="Export active access token for use in Linux/Docker environment")

    args = parser.parse_args()

    if args.export_token:
        try:
            from auth import get_gapgpt_access_token
            token = get_gapgpt_access_token()
            token_path = os.path.join(SCRIPT_DIR, ".token")
            with open(token_path, "w", encoding="utf-8") as f:
                f.write(token)
            print(f"Token saved to: {token_path}")
            print(f"Export command for Linux/Docker:\nexport GAPGPT_TOKEN=\"{token}\"")
        except Exception as e:
            print(f"Error exporting token: {e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    prompt_text = args.prompt or args.prompt_flag

    cmd = [NODE_PATH, MJS_PATH]

    if args.status:
        cmd += ["--status"]
    elif args.quota:
        cmd += ["--quota"]
    elif args.list is not None:
        cmd += ["--list", str(args.list)]
    elif args.history:
        cmd += ["--history", args.history]
    elif prompt_text:
        cmd += ["--prompt", prompt_text, "--model", args.model, "--effort", args.effort]
        if args.chat_id:
            cmd += ["--chat-id", args.chat_id]
        if args.json:
            cmd += ["--json"]
    else:
        parser.print_help()
        sys.exit(0)

    res = subprocess.run(cmd)
    sys.exit(res.returncode)

if __name__ == "__main__":
    main()
