exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  const target = (event.headers || {})["x-relay-target"];
  const relayPath = (event.headers || {})["x-relay-path"] || "";
  if (!target) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing x-relay-target header" })
    };
  }

  let targetUrl;
  try {
    targetUrl = new URL(relayPath ? target.replace(/\/$/, "") + relayPath : target);
  } catch(e) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid URL: " + e.message })
    };
  }

  const skip = new Set([
    "x-relay-target",
    "x-relay-path",
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-nf-request-id",
    "cdn-loop"
  ]);

  const fwd = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (!skip.has(k.toLowerCase())) fwd[k] = v;
  }

  let res;
  try {
    res = await fetch(targetUrl.toString(), {
      method: event.httpMethod,
      headers: fwd,
      body: event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD"
        ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body)
        : undefined,
      signal: AbortSignal.timeout(9000),
    });
  } catch(e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Upstream fetch failed: " + e.message })
    };
  }

  const rh = corsHeaders();
  const skipR = new Set(["transfer-encoding", "connection", "keep-alive", "content-encoding"]);
  for (const [k, v] of res.headers.entries()) {
    if (!skipR.has(k.toLowerCase())) rh[k] = v;
  }

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: rh,
    body
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}
