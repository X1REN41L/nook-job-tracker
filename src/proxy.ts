import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 2000;
let bucket = { count: 0, resetAt: 0 };

export function proxy() {
  const now = Date.now();
  if (bucket.resetAt <= now) bucket = { count: 0, resetAt: now + WINDOW_MS };
  if (bucket.count >= MAX_REQUESTS) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) } },
    );
  }

  bucket.count += 1;
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
