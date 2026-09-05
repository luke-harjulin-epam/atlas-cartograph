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
