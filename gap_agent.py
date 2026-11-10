#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GapChat Autonomous Agent CLI (gap_agent.py)
-------------------------------------------
Runs an autonomous Agentic ReAct loop (file editing, testing, debugging)
using the free GapGPT Chat quota (GPT-6 Astra or Claude Opus 5.5).
"""

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
AGENT_MJS_PATH = os.path.join(SCRIPT_DIR, "gap_agent.mjs")

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
    parser = argparse.ArgumentParser(description="GapChat Autonomous Agent CLI (Zero Dollar Cost)")
    parser.add_argument("task", nargs="?", default="", help="Task description to execute autonomously")
    parser.add_argument("-t", "--task", dest="task_flag", default="", help="Task flag")
    parser.add_argument("-C", "--cd", "--workspace", dest="workspace", default="", help="Workspace directory (default: current directory)")
    parser.add_argument("-m", "--model", default="gpt-6-astra", help="Model to use (default: gpt-6-astra)")
    parser.add_argument("-e", "--effort", default="medium", choices=["high", "medium", "low", "deep", "thoughtful", "quick"], help="Reasoning effort")
    parser.add_argument("--max-turns", type=int, default=8, help="Maximum agent turns (default: 8)")
    parser.add_argument("--timeout", type=int, default=300, help="Total execution timeout in seconds (default: 300)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON result")

    args = parser.parse_args()
    task_text = args.task or args.task_flag
    if not task_text:
        parser.print_help()
        sys.exit(1)

    cmd = [
        NODE_PATH,
        AGENT_MJS_PATH,
        task_text,
        "--workspace", args.workspace or os.getcwd(),
        "--model", args.model,
        "--effort", args.effort,
        "--max-turns", str(args.max_turns),
        "--timeout", str(args.timeout)
    ]
    if args.json:
        cmd.append("--json")

    try:
        proc = subprocess.run(cmd, cwd=os.getcwd(), text=True, encoding="utf-8")
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        print("\nAgent execution interrupted by user.", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"Error running agent: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
