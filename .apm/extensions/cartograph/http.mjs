export function requireCanvas(req, endpoint) {
  const url = new URL(endpoint);
  if (req.headers.host !== url.host ||
      req.headers["x-cartograph-client"] !== "canvas" ||
      (req.headers.origin && req.headers.origin !== url.origin) ||
      (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))) {
    throw Object.assign(new Error("This endpoint requires a same-origin canvas request."), { statusCode: 403 });
  }
}
