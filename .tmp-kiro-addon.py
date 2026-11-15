"""mitmproxy addon: log Kiro API request/response metadata.

JSONL → .tmp-kiro-flows.jsonl. Header values for auth-ish headers are redacted;
everything else is kept verbatim so the UA/identity tokens can be compared
token by token. Traffic passes through untouched.
"""
import json

from mitmproxy import http

OUT = "C:/Users/ACER/documents/Project/panrouter/.tmp-kiro-flows.jsonl"
HOSTS = ("q.", "codewhisperer", "runtime.", "kiro.dev", "amazonaws.com", "desktop.kiro.dev")
SECRET_HEADERS = {"authorization", "x-amz-sso-bearer", "cookie", "x-amz-security-token", "set-cookie"}


def _log(entry: dict) -> None:
    with open(OUT, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def _interesting(host: str) -> bool:
    return any(h in host for h in HOSTS)


def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if not _interesting(host):
        return
    headers = {}
    for k, v in flow.request.headers.items():
        headers[k] = "<redacted>" if k.lower() in SECRET_HEADERS else v
    _log({
        "dir": "request",
        "method": flow.request.method,
        "host": host,
        "path": flow.request.path.split("?")[0],
        "headers": headers,
        "contentLength": len(flow.request.raw_content or b""),
    })


def response(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if not _interesting(host):
        return
    _log({
        "dir": "response",
        "host": host,
        "path": flow.request.path.split("?")[0],
        "status": flow.response.status_code,
    })
