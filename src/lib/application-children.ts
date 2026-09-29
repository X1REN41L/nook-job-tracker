import { EventType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { apiError, isDatabaseContention, parseRequest } from "@/lib/api";
import { contactInputSchema, interviewInputSchema, noteInputSchema, revisionOnlySchema } from "@/lib/application-schema";
import { applicationInclude, type StoredApplication } from "@/lib/application-record";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type ChildResult =
  | { status: "ok"; application: StoredApplication }
  | { status: "conflict"; application: StoredApplication }
  | { status: "missing" }
  | { status: "child-missing" };

class ChildNotFound extends Error {}

/**
 * Changes an application's interviews, contacts, or dated notes under the same revision check as
 * every other application edit: the change applies only if `revision` is current, and it bumps it.
 */
async function mutateChildren(id: string, revision: number, change: (tx: Transaction) => Promise<void>): Promise<ChildResult> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const current = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
      if (!current) return { status: "missing" };
      if (current.revision !== revision) return { status: "conflict", application: current };
      const application = await serializeWrite(() => prisma.$transaction(async (tx) => {
        const updated = await tx.application.updateMany({ where: { id, revision }, data: { revision: { increment: 1 } } });
        if (!updated.count) return null;
        await change(tx);
        return tx.application.findUniqueOrThrow({ where: { id }, include: applicationInclude });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      if (application) return { status: "ok", application };
      const latest = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
      return latest ? { status: "conflict", application: latest } : { status: "missing" };
    } catch (error) {
      if (error instanceof ChildNotFound) return { status: "child-missing" };
      if (!isDatabaseContention(error) || attempt === 5) throw error;
    }
  }
  throw new Error("Application update retry limit reached");
}

function respond(result: ChildResult, successStatus = 200) {
  if (result.status === "missing") return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (result.status === "child-missing") return NextResponse.json({ error: "That item no longer exists" }, { status: 404 });
  if (result.status === "conflict") {
    return NextResponse.json({
      error: "Application changed since it was loaded. The current version is included so you can review it.",
      application: result.application,
    }, { status: 409 });
  }
  return NextResponse.json({ application: result.application }, { status: successStatus });
}

function requireChange(count: number) {
  if (!count) throw new ChildNotFound();
}

type Params = { params: Promise<{ id: string; itemId?: string }> };
type Collection = "interviews" | "contacts" | "notes";

const creators = {
  interviews: async (body: Uint8Array, id: string) => {
    const { revision, ...data } = parseRequest(interviewInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => { await tx.interview.create({ data: { ...data, applicationId: id } }); });
  },
  contacts: async (body: Uint8Array, id: string) => {
    const { revision, ...data } = parseRequest(contactInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => { await tx.contact.create({ data: { ...data, applicationId: id } }); });
  },
  notes: async (body: Uint8Array, id: string) => {
    const { revision, text } = parseRequest(noteInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => {
      await tx.applicationEvent.create({ data: { applicationId: id, type: EventType.NOTE_ADDED, detail: text, createdAt: new Date() } });
    });
  },
};

const updaters = {
  interviews: async (body: Uint8Array, id: string, itemId: string) => {
    const { revision, ...data } = parseRequest(interviewInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => requireChange((await tx.interview.updateMany({ where: { id: itemId, applicationId: id }, data })).count));
  },
  contacts: async (body: Uint8Array, id: string, itemId: string) => {
    const { revision, ...data } = parseRequest(contactInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => requireChange((await tx.contact.updateMany({ where: { id: itemId, applicationId: id }, data })).count));
  },
  // An edited note keeps its original date.
  notes: async (body: Uint8Array, id: string, itemId: string) => {
    const { revision, text } = parseRequest(noteInputSchema, parseMutationJson(body));
    return mutateChildren(id, revision, async (tx) => requireChange((await tx.applicationEvent.updateMany({
      where: { id: itemId, applicationId: id, type: EventType.NOTE_ADDED }, data: { detail: text },
    })).count));
  },
};

const deleters = {
  interviews: (tx: Transaction, id: string, itemId: string) => tx.interview.deleteMany({ where: { id: itemId, applicationId: id } }),
  contacts: (tx: Transaction, id: string, itemId: string) => tx.contact.deleteMany({ where: { id: itemId, applicationId: id } }),
  notes: (tx: Transaction, id: string, itemId: string) => tx.applicationEvent.deleteMany({ where: { id: itemId, applicationId: id, type: EventType.NOTE_ADDED } }),
};

/** POST handler that adds one item to an application's collection. */
export function childCollectionRoute(collection: Collection) {
  return async function POST(request: Request, { params }: Params) {
    try {
      const check = await checkMutationRequest(request);
      if (!check.ok) return check.response;
      const { id } = await params;
      return respond(await creators[collection](check.body, id), 201);
    } catch (error) {
      return apiError(error);
    }
  };
}

/** PUT and DELETE handlers for one item in an application's collection. */
export function childItemRoute(collection: Collection) {
  async function PUT(request: Request, { params }: Params) {
    try {
      const check = await checkMutationRequest(request);
      if (!check.ok) return check.response;
      const { id, itemId = "" } = await params;
      return respond(await updaters[collection](check.body, id, itemId));
    } catch (error) {
      return apiError(error);
    }
  }
  async function DELETE(request: Request, { params }: Params) {
    try {
      const check = await checkMutationRequest(request);
      if (!check.ok) return check.response;
      const { id, itemId = "" } = await params;
      const { revision } = parseRequest(revisionOnlySchema, parseMutationJson(check.body));
      return respond(await mutateChildren(id, revision, async (tx) => requireChange((await deleters[collection](tx, id, itemId)).count)));
    } catch (error) {
      return apiError(error);
    }
  }
  return { PUT, DELETE };
}
