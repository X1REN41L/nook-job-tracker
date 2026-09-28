import { NextResponse, type NextRequest } from "next/server";

import { isAllowedHost } from "@/lib/allowed-host";

export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "Host is not allowed" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
