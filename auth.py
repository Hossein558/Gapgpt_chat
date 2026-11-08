import json
import base64
import ctypes
from ctypes import wintypes
import os
import sys

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte))
    ]

def get_gapgpt_tokens():
    # 1. Environment variables (Linux, Docker, Cloud)
    access = os.environ.get("GAPGPT_TOKEN")
    refresh = os.environ.get("GAPGPT_REFRESH_TOKEN")
    if access and access.strip():
        return {
            "accessToken": access.strip(),
            "refreshToken": (refresh or "").strip()
        }

    # 2. Local token file (.token)
    token_file = os.path.join(os.path.dirname(__file__), ".token")
    if os.path.exists(token_file):
        try:
            with open(token_file, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content.startswith("{"):
                    data = json.loads(content)
                    return {
                        "accessToken": data.get("accessToken") or data.get("access") or "",
                        "refreshToken": data.get("refreshToken") or data.get("refresh") or ""
                    }
                elif content:
                    return { "accessToken": content, "refreshToken": "" }
        except Exception:
            pass

    # 3. Windows DPAPI extraction (Windows Desktop)
    if sys.platform != "win32":
        raise EnvironmentError("GAPGPT_TOKEN environment variable not set (required on non-Windows systems)")

    CryptUnprotectData = ctypes.windll.crypt32.CryptUnprotectData
    CryptUnprotectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB)
    ]
    CryptUnprotectData.restype = wintypes.BOOL

    def dpapi_decrypt(cipher_bytes):
        in_blob = DATA_BLOB(len(cipher_bytes), (ctypes.c_byte * len(cipher_bytes))(*cipher_bytes))
        out_blob = DATA_BLOB()
        descr = wintypes.LPWSTR()
        res = CryptUnprotectData(ctypes.byref(in_blob), ctypes.byref(descr), None, None, None, 0, ctypes.byref(out_blob))
        if res:
            out_bytes = bytes(ctypes.string_at(out_blob.pbData, out_blob.cbData))
            ctypes.windll.kernel32.LocalFree(out_blob.pbData)
            return out_bytes
        else:
            raise Exception("CryptUnprotectData failed")

    local_state_path = os.path.expandvars(r"%APPDATA%\GapGPT\Local State")
    auth_path = os.path.expandvars(r"%APPDATA%\GapGPT\desktop-auth.secure.json")

    if not os.path.exists(local_state_path) or not os.path.exists(auth_path):
        raise FileNotFoundError("GapGPT config files not found in AppData")

    with open(local_state_path, "r", encoding="utf-8") as f:
        local_state = json.load(f)

    encrypted_key = base64.b64decode(local_state["os_crypt"]["encrypted_key"])
    # Skip first 5 bytes ("DPAPI")
    master_key = dpapi_decrypt(encrypted_key[5:])

    with open(auth_path, "r", encoding="utf-8") as f:
        auth_data = json.load(f)

    cipher_bytes = base64.b64decode(auth_data["ciphertext"])
    nonce = cipher_bytes[3:15]
    payload = cipher_bytes[15:-16]
    tag = cipher_bytes[-16:]

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    aesgcm = AESGCM(master_key)
    decrypted = aesgcm.decrypt(nonce, payload + tag, None)
    parsed = json.loads(decrypted.decode("utf-8"))

    return {
        "accessToken": parsed.get("accessToken") or parsed.get("access") or "",
        "refreshToken": parsed.get("refreshToken") or parsed.get("refresh") or "",
        "authCookie": parsed.get("authCookie") or ""
    }

def get_gapgpt_access_token():
    tokens = get_gapgpt_tokens()
    return tokens.get("accessToken", "")

if __name__ == "__main__":
    try:
        if "--json" in sys.argv:
            tokens = get_gapgpt_tokens()
            print(json.dumps(tokens, indent=2))
        else:
            t = get_gapgpt_access_token()
            print(t)
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)
