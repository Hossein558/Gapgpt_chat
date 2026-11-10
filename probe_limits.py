#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GapGPT Limit Probe & Diagnostic Tool (probe_limits.py)
-----------------------------------------------------
Inspects live account quotas, tests payload boundaries, uploads files
(images, documents, large text) to retrieve file_tokens, and benchmarks
endpoint capacities for optimal usage with Antigravity.
"""

import sys
import os
import json
import urllib.request
import urllib.error
import argparse
import uuid
import mimetypes

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(SCRIPT_DIR, ".token")
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")

def get_auth_token():
    """Retrieve active access token from env, .token, or auth.py"""
    if os.environ.get("GAPGPT_TOKEN"):
        return os.environ["GAPGPT_TOKEN"].strip()
    
    if os.path.exists(TOKEN_PATH):
        try:
            with open(TOKEN_PATH, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content.startswith("{"):
                    data = json.loads(content)
                    return data.get("accessToken") or data.get("token") or ""
                return content
        except Exception:
            pass

    if os.path.exists(ENV_PATH):
        try:
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("GAPGPT_TOKEN="):
                        return line.strip().split("=", 1)[1].strip()
        except Exception:
            pass

    try:
        from auth import get_gapgpt_tokens
        tokens = get_gapgpt_tokens()
        return tokens.get("accessToken", "")
    except Exception:
        pass

    return None

def fetch_profile(token):
    """Fetch live account metadata from /api/v1/profile"""
    req = urllib.request.Request(
        "https://gapgpt.ir/api/v1/profile",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "GapGPT-Desktop",
            "Accept": "application/json"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def upload_file_to_gapgpt(token, file_bytes, filename, content_type="application/octet-stream"):
    """Upload binary or text file to /api/v1/upload_file and return file_token and CDN url"""
    boundary = "----GapProbeBoundary" + uuid.uuid4().hex
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    footer = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = header + file_bytes + footer

    req = urllib.request.Request(
        "https://gapgpt.ir/api/v1/upload_file",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "GapGPT-Desktop",
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def format_quota_report(profile):
    """Format full human-readable quota and capability report"""
    sub = profile.get("subscription", {})
    lim = profile.get("limits", {})
    acct = profile.get("account_context", {})
    
    org_name = "حساب شخصی"
    for opt in acct.get("options", []):
        if opt.get("id") == acct.get("active_workspace_id"):
            org_name = opt.get("name", "سازمانی")

    report = []
    report.append("================================================================")
    report.append("          گزارش ظرفیت و سهمیه‌های زنده حساب کاربری GAPGPT       ")
    report.append("================================================================")
    report.append(f"• سازمان / فضای فعال:       {org_name}")
    report.append(f"• نوع اشتراک:               {'حرفه‌ای (Pro)' if sub.get('subtype') == 'P' else sub.get('subtype')}")
    report.append(f"• اعتبار زمانی اشتراک:       {sub.get('human_readable_start_time', '-')} تا {sub.get('human_readable_end_time', '-')}")
    report.append("----------------------------------------------------------------")
    report.append("📊 سهمیه‌های پیام و پردازش (سهمیه چت):")
    report.append(f"  - سقف ۳ ساعته مدل‌های پرچم‌دار:  {sub.get('three_hour_gpt4_gen_limit', 'نامحدود')} پیام")
    report.append(f"  - سقف روزانه مدل‌های پرچم‌دار:     {sub.get('daily_gpt4_gen_limit', 'نامحدود')} پیام")
    report.append(f"  - وضعیت ریت‌لیمیت پیام:         {'⛔ محدود شده' if lim.get('message_limited') else '✅ کاملاً آزاد و فعال'}")
    if lim.get('next_message_time'):
        report.append(f"  - زمان رفع محدودیت پیام:       {lim.get('next_message_time')}")
    report.append("----------------------------------------------------------------")
    report.append("🤖 سهمیه و اعتبار اجنتیک (GapCode):")
    report.append(f"  - اعتبار دلاری هفتگی اجنتیک:    ${sub.get('weekly_agentic_credit_usd', '0.00')} دلار")
    report.append(f"  - دسترسی موتور:                فعال در مسیر برنامه‌های دسکتاپ")
    report.append("----------------------------------------------------------------")
    report.append("📁 سهمیه و وضعیت فایل‌ها:")
    report.append(f"  - وضعیت محدودیت آپلود فایل:    {'⛔ محدود شده' if lim.get('file_limited') else '✅ آزاد و آماده پذیرش'}")
    if lim.get('next_file_time'):
        report.append(f"  - زمان آزادسازی آپلود:        {lim.get('next_file_time')}")
    report.append("----------------------------------------------------------------")
    report.append("🎨 سهمیه‌های چندرسانه‌ای:")
    report.append(f"  - سقف تولید تصویر:             {sub.get('image_gen_limit', 0)} تصویر")
    report.append(f"  - سقف هفتگی تولید ویدیو:        {sub.get('weekly_video_gen_limit', 0)} ویدیو")
    report.append("================================================================")
    return "\n".join(report)

def main():
    parser = argparse.ArgumentParser(description="GapGPT Limit Probe & Diagnostic Tool")
    parser.add_argument("-q", "--quota", "--status", dest="status", action="store_true", help="Display full live account quotas and limits")
    parser.add_argument("--json", action="store_true", help="Output raw JSON format")
    parser.add_argument("--upload", dest="upload_file", metavar="FILE_PATH", help="Upload a local file and return file_token & CDN url")
    parser.add_argument("--test-upload", action="store_true", help="Run a test upload with sample payload to benchmark file upload performance")
    parser.add_argument("--upload-text", dest="text_content", metavar="TEXT", help="Upload a large text string directly as a virtual file and return token")

    args = parser.parse_args()

    token = get_auth_token()
    if not token:
        print("خطا: توکن فعال GapGPT یافت نشد. لطفاً ابتدا لاگین نمایید.", file=sys.stderr)
        sys.exit(1)

    if args.upload_file:
        file_path = os.path.abspath(args.upload_file)
        if not os.path.exists(file_path):
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            sys.exit(1)
        
        filename = os.path.basename(file_path)
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = "application/octet-stream"

        with open(file_path, "rb") as f:
            data = f.read()

        print(f"Uploading '{filename}' ({len(data)} bytes, {content_type})...")
        try:
            res = upload_file_to_gapgpt(token, data, filename, content_type)
            if args.json:
                print(json.dumps(res, indent=2, ensure_ascii=False))
            else:
                print("✅ آپلود با موفقیت انجام شد:")
                print(f"• File Token: {res.get('file_token')}")
                print(f"• CDN URL:    {res.get('url')}")
        except Exception as e:
            print(f"Upload failed: {e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    if args.text_content:
        text_bytes = args.text_content.encode("utf-8")
        filename = f"context_{uuid.uuid4().hex[:8]}.txt"
        print(f"Uploading text as virtual file '{filename}' ({len(text_bytes)} bytes)...")
        try:
            res = upload_file_to_gapgpt(token, text_bytes, filename, "text/plain")
            if args.json:
                print(json.dumps(res, indent=2, ensure_ascii=False))
            else:
                print("✅ متن به صورت فایل آپلود شد و توکن صادر گردید:")
                print(f"• File Token: {res.get('file_token')}")
                print(f"• CDN URL:    {res.get('url')}")
        except Exception as e:
            print(f"Upload failed: {e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    if args.test_upload:
        sample_size = 50 * 1024  # 50 KB dummy sample
        dummy_content = b"GapGPT Limit Probe Test Content\n" + (b"A" * (sample_size - 32))
        filename = f"probe_test_{uuid.uuid4().hex[:6]}.dat"
        print(f"Testing file upload endpoint with {sample_size // 1024} KB payload...")
        try:
            res = upload_file_to_gapgpt(token, dummy_content, filename, "application/octet-stream")
            print("✅ تست آپلود موفقیت‌آمیز بود:")
            print(f"• File Token: {res.get('file_token')}")
            print(f"• Status: 200 OK | File accepted by S3 storage")
        except Exception as e:
            print(f"Test upload failed: {e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    # Default action: profile & quota
    try:
        profile = fetch_profile(token)
        if args.json:
            print(json.dumps(profile, indent=2, ensure_ascii=False))
        else:
            print(format_quota_report(profile))
    except Exception as e:
        print(f"Error fetching profile: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
