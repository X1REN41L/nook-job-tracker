import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const body = parseMutationJson(checked.body);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
      return NextResponse.json({ error: "Request body must be an empty JSON object" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.applicationEvent.deleteMany();
      await tx.undoSnapshot.deleteMany();
      await tx.application.deleteMany();
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
