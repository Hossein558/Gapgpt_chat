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

def get_gapgpt_access_token():
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
    return parsed.get("accessToken")

if __name__ == "__main__":
    try:
        t = get_gapgpt_access_token()
        print(t)
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)
