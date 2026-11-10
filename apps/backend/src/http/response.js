export function sendJson(response, status, body, requestId, extraHeaders = {}) {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Request-Id': requestId,
    ...extraHeaders,
  });
  response.end(payload);
}

export function sendData(response, status, data, requestId, meta, extraHeaders) {
  sendJson(response, status, meta ? { data, meta } : { data }, requestId, extraHeaders);
}

export function sendBuffer(response, status, buffer, contentType, requestId, extraHeaders = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'X-Request-Id': requestId,
    ...extraHeaders,
  });
  response.end(buffer);
}

export function sendError(response, error, requestId) {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  };

  if (error.details !== undefined) {
    body.error.details = error.details;
  }

  sendJson(response, error.status, body, requestId);
}
