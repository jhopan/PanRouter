"""
mitmproxy addon — capture Antigravity (agy CLI / IDE) traffic to JSONL.

Focus: how the account reports "needs verification" (VALIDATION_REQUIRED /
eligibility.eligible=false) versus a healthy account. We capture:
  - the response bodies of the loadProject / loadCodeAssist / quota endpoints
  - the chat endpoint responses

Run:
  mitmdump -p 8915 -s scripts/ag-mitm-addon.py
Then:
  HTTPS_PROXY=http://127.0.0.1:8915 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem \
    agy -p --model claude-sonnet-4-6 "hi"
"""
import json, os, datetime

OUT = os.environ.get("MITM_OUT", "C:/Users/ACER/AppData/Local/Temp/ag-mitm.jsonl")

# Hosts that matter for the antigravity wire.
HOSTS = ("antigravity", "googleapis.com", "google.com")

# Paths that carry the eligibility / quota signal.
INTERESTING = ("loadproject", "loadcodeassist", "quotasummary", "quota",
               "retrieveuserquota", "generateassistantresponse", "v1internal",
               "fetch", "subscription", "eligibility")


def _host(flow):
    return (flow.request.pretty_host or "").lower()


def _is_interesting(flow):
    h = _host(flow)
    if not any(t in h for t in HOSTS):
        return False
    p = (flow.request.path or "").lower()
    return any(t in p for t in INTERESTING)


def _safe(text, limit=6000):
    try:
        if not text:
            return None
        return text[:limit]
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
        "path": req.path[:300],
        "req_headers": dict(req.headers),
        "req_body": _safe(req.get_text(strict=False)),
    }
    if resp is not None:
        rec["status"] = resp.status_code
        rec["resp_headers"] = dict(resp.headers)
        rec["resp_body"] = _safe(resp.get_text(strict=False))
    with open(OUT, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


class AntigravityAddon:
    def request(self, flow):
        if _is_interesting(flow):
            _record(flow, "request")
            print(f"[ag-mitm] → {flow.request.method} {flow.request.pretty_host}{flow.request.path[:70]}")

    def response(self, flow):
        if _is_interesting(flow):
            _record(flow, "response")
            print(f"[ag-mitm] ← {flow.response.status_code} {flow.request.pretty_host}{flow.request.path[:60]}")


addons = [AntigravityAddon()]
