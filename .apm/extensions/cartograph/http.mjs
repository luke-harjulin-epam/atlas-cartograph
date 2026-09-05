export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export async function readJsonBody(req) {
  const tooLarge = () => Object.assign(new Error("Request body exceeds 1 MiB."), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  // Keep the socket writable so the caller can send 413 before closing it.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.byteLength;
    if (size > MAX_JSON_BODY_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Request body must be a JSON object."), { statusCode: 400 });
  }
  return body;
}

export function requireCanvas(req, endpoint, { allowEventSource = false } = {}) {
  const url = new URL(endpoint);
  // Native EventSource cannot set custom headers; Fetch Metadata is browser-controlled.
  const eventSource = allowEventSource && req.method === "GET" &&
    req.headers.accept === "text/event-stream" && req.headers["sec-fetch-site"] === "same-origin";
  if (req.headers.host !== url.host ||
      (req.headers["x-cartograph-client"] !== "canvas" && !eventSource) ||
      (req.headers.origin && req.headers.origin !== url.origin) ||
      (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))) {
    throw Object.assign(new Error("This endpoint requires a same-origin canvas request."), { statusCode: 403 });
  }
}
