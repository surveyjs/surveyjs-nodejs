// HTTP plumbing the routes share: errors with a status, and outbound fetch with a timeout. Not demo code.

/**
 * An error the final handler answers as { error: message } with this status (app.js). `expose` says the message
 * is meant for the client, as in Express's own http-errors.
 */
export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, expose: true }, extra);
}

/** Why an outbound call failed: the remote end took too long, wasn't listening, or answered with an error. */
export class FetchError extends Error {
  constructor(message, { timedOut = false, refused = false, status = null, cause } = {}) {
    super(message, { cause });
    Object.assign(this, { timedOut, refused, status });
  }
}

/**
 * fetch() with a timeout, which tells a timeout from a refused connection and treats a 4xx or 5xx answer as a
 * failure (fetch itself only throws when nothing answered). Returns the response, whose body is still unread.
 */
export async function fetchWithTimeout(url, { timeout, ...init }) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const timedOut = error.name === "TimeoutError";
    const refused = error.cause?.code === "ECONNREFUSED";
    throw new FetchError(`${new URL(url).origin} ${timedOut ? "timed out" : refused ? "refused the connection" : "is unreachable"}`, { timedOut, refused, cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new FetchError(`${new URL(url).origin} answered ${response.status}`, { status: response.status });
  }
  return response;
}
