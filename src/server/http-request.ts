export const MAX_MUTATION_BODY_BYTES = 16 * 1024;
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export class RequestBodyError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(status: 400 | 413 | 415, message: string) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export function isJsonContentType(request: Request): boolean {
  const value = request.headers.get("content-type");
  if (!value) return false;
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function declaredBodyLength(request: Request): number | undefined {
  const value = request.headers.get("content-length")?.trim();
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new RequestBodyError(400, "Content-Length is invalid");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new RequestBodyError(413, "Payload too large");
  }
  return length;
}

/**
 * Reads at most `maxBytes` from the request stream. Content-Length is only an
 * early rejection hint; the streamed byte count remains authoritative.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new RequestBodyError(413, "Payload too large");
  }
  if (!request.body) {
    if (declaredLength && declaredLength > 0) {
      throw new RequestBodyError(400, "Request body is incomplete");
    }
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        try {
          await reader.cancel("Payload too large");
        } catch {
          // The size decision is already final; cancellation is best-effort.
        }
        throw new RequestBodyError(413, "Payload too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Request body could not be read");
  } finally {
    reader.releaseLock();
  }

  if (declaredLength !== undefined && received !== declaredLength) {
    throw new RequestBodyError(400, "Request body length does not match Content-Length");
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson(request: Request, maxBytes = MAX_MUTATION_BODY_BYTES): Promise<unknown> {
  if (!isJsonContentType(request)) {
    throw new RequestBodyError(415, "Request body must use application/json");
  }
  const rawBody = await readBoundedBody(request, maxBytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError(400, "Request body is not valid JSON");
  }
}

