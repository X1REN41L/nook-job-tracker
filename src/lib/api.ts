import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError, type ZodIssue } from "zod";

export type ValidationIssue = { path: string; message: string };

export function formatValidationIssues(error: ZodError): ValidationIssue[] {
  return collectValidationIssues(error.issues).map(({ path, message }) => ({ path, message }));
}

export function validationErrorResponse(error: ZodError, message = "Invalid request data") {
  return NextResponse.json({ error: message, issues: formatValidationIssues(error) }, { status: 400 });
}

export function apiError(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (error instanceof ZodError) {
    return validationErrorResponse(error);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  console.error("API request failed", error instanceof Error ? error.message : "Unknown error");
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

type CollectedValidationIssue = ValidationIssue & { weight: number };

function collectValidationIssues(issues: readonly ZodIssue[], parentPath: PropertyKey[] = []): CollectedValidationIssue[] {
  const collected: CollectedValidationIssue[] = [];

  for (const issue of issues) {
    const path = [...parentPath, ...issue.path];
    if (issue.code === "invalid_union") {
      const branches = issue.errors.map((branch) => collectValidationIssues(branch, path));
      const bestBranch = branches.reduce<CollectedValidationIssue[] | undefined>((best, branch) => {
        const score = branch.reduce((total, item) => total + item.weight, 0);
        const bestScore = best?.reduce((total, item) => total + item.weight, 0) ?? -1;
        return score > bestScore ? branch : best;
      }, undefined);

      if (bestBranch?.length) collected.push(...bestBranch);
      else collected.push({ path: formatPath(path), message: issue.message, weight: 1 });
      continue;
    }

    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        collected.push({ path: formatPath([...path, key]), message: "Unrecognized field", weight: 0 });
      }
      continue;
    }

    collected.push({
      path: formatPath(path),
      message: issue.message,
      weight: validationIssueWeight(issue),
    });
  }

  return collected;
}

function validationIssueWeight(issue: ZodIssue) {
  switch (issue.code) {
    case "invalid_type":
      return 1;
    case "invalid_value":
      return 2;
    case "unrecognized_keys":
      return 0;
    case "invalid_format":
    case "too_big":
    case "too_small":
    case "not_multiple_of":
    case "custom":
      return 3;
    case "invalid_key":
    case "invalid_element":
      return 2;
    case "invalid_union":
      return 1;
  }
}

function formatPath(path: PropertyKey[]) {
  if (!path.length) return "body";
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${String(segment)}]`;
    const value = String(segment);
    return formatted ? `${formatted}.${value}` : value;
  }, "");
}
