"""
mitmproxy addon — capture CodeBuddy CLI request/response headers to JSONL.
Run with:
  mitmdump -p 8914 -s scripts/codebuddy-mitm-addon.py
Then run CLI:
  HTTPS_PROXY=http://127.0.0.1:8914 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem codebuddy -p --model deepseek-v4.1-flash "hi"
"""
import json, re, datetime, os

OUT = os.environ.get("MITM_OUT", "C:/Users/ACER/AppData/Local/Temp/codebuddy-mitm.jsonl")

TARGETS = [
    "codebuddy.ai",
    "codebuddy",
]

def _is_target(flow):
    host = flow.request.pretty_host or ""
    return any(t in host for t in TARGETS)

def _safe_body(flow, which="request"):
    try:
        r = flow.request if which == "request" else flow.response
        if r is None:
            return None
        raw = r.get_text(strict=False) or ""
        return raw[:4000]
    except Exception:
        return None

def _record(flow, kind):
    req = flow.request
    resp = flow.response if kind == "response" else None

    rec = {
        "ts": datetime.datetime.utcnow().isoformat(),
        "kind": kind,
        "method": req.method,
        "host": req.pretty_host,
        "path": req.path[:200],
        "req_headers": dict(req.headers),
        "req_body_preview": (_safe_body(flow, "request") or "")[:2000],
    }
    if resp is not None:
        rec["status"] = resp.status_code
        rec["resp_headers"] = dict(resp.headers)
        rec["resp_body_preview"] = (_safe_body(flow, "response") or "")[:2000]
    with open(OUT, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

class CodeBuddyAddon:
    def request(self, flow):
        if _is_target(flow):
            _record(flow, "request")
            print(f"[cb-mitm] → {flow.request.method} {flow.request.pretty_host}{flow.request.path[:80]}")

    def response(self, flow):
        if _is_target(flow):
            _record(flow, "response")
            print(f"[cb-mitm] ← {flow.response.status_code} {flow.request.pretty_host}{flow.request.path[:60]}")

addons = [CodeBuddyAddon()]
