import { NextResponse } from "next/server";
import { MAX_BACKUP_FILE_BYTES } from "@/lib/backup-limits";

export const MAX_MUTATION_BODY_BYTES = MAX_BACKUP_FILE_BYTES;

type MutationRequestResult =
  | { ok: true; body: Uint8Array }
  | { ok: false; response: NextResponse };

export async function checkMutationRequest(request: Request): Promise<MutationRequestResult> {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || !isMatchingOrigin(origin, request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request origin is missing or does not match this application" }, { status: 403 }),
    };
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 }),
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Content-Length must be a valid non-negative integer" }, { status: 400 }),
      };
    }
    if (Number(contentLength) > MAX_MUTATION_BODY_BYTES) return tooLarge();
  }

  if (!request.body) return { ok: true, body: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MUTATION_BODY_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

export function parseMutationJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new SyntaxError("Request body must be valid JSON");
  }
}

function isMatchingOrigin(origin: string, request: Request) {
  try {
    const parsedOrigin = new URL(origin);
    const requestHost = request.headers.get("host");
    if (!requestHost) return false;
    const requestOrigin = new URL(`${new URL(request.url).protocol}//${requestHost}`).origin;
    return parsedOrigin.origin === origin && parsedOrigin.origin === requestOrigin;
  } catch {
    return false;
  }
}

function isJsonContentType(contentType: string | null) {
  if (!contentType) return false;
  const [mediaType, ...parameters] = contentType.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json" || parameters.length > 1) return false;
  return parameters.length === 0 || /^\s*charset\s*=\s*(?:"[^"]+"|[^\s;]+)\s*$/i.test(parameters[0]);
}

function tooLarge(): MutationRequestResult {
  return {
    ok: false,
    response: NextResponse.json({ error: "Request body must not exceed 10 MB" }, { status: 413 }),
  };
}
