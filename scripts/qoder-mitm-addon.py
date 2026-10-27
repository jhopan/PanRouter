"""mitmproxy addon: capture Qoder CLI requests to a JSONL file.

Writes one line per request with the full header set and a body preview, and
prints a one-line summary for the chat endpoint so the interesting traffic is
visible without opening the file.
"""

import json
import os
import time

OUT = os.environ.get("MITM_OUT", "C:/Users/ACER/AppData/Local/Temp/qoder-mitm.jsonl")
CHAT_MARKERS = ("agent_chat_generation", "/chat/completions", "/llm/v1/messages")


def _flatten(headers):
    out = {}
    for k, v in headers.items():
        out[k] = v
    return out


def request(flow):
    try:
        body = flow.request.get_content(strict=False) or b""
    except Exception:
        body = b""

    path = flow.request.path or ""
    is_chat = any(m in path for m in CHAT_MARKERS)

    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "method": flow.request.method,
        "scheme": flow.request.scheme,
        "host": flow.request.pretty_host,
        "port": flow.request.port,
        "path": path,
        "http_version": flow.request.http_version,
        "headers": _flatten(flow.request.headers),
        "body_len": len(body),
        "body_preview": body[:4000].decode("utf-8", "replace"),
        "is_chat": is_chat,
    }

    with open(OUT, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    if is_chat:
        print(f"[mitm] CHAT {flow.request.method} {path} ({len(body)}B)", flush=True)
    else:
        print(f"[mitm] {flow.request.method} {path} ({len(body)}B)", flush=True)


def response(flow):
    if not any(m in (flow.request.path or "") for m in CHAT_MARKERS):
        return
    try:
        body = flow.response.get_content(strict=False) or b""
    except Exception:
        body = b""
    print(f"[mitm] RESP {flow.response.status_code} {len(body)}B", flush=True)
    if flow.response.status_code >= 400:
        print(f"[mitm] RESP-BODY {body[:500].decode('utf-8', 'replace')}", flush=True)
