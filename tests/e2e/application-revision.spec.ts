import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

test("keeps an edit form open and refreshes the record after a stale save", async ({ page, request }) => {
  const created = await request.post("/api/applications", {
    data: {
      company: `Revision check ${randomUUID()}`,
      role: "Original role",
      status: "APPLIED",
      appliedDate: "2026-09-22",
    },
    headers: sameOriginMutationHeaders,
  });
  expect(created.status()).toBe(201);
  const { application } = await created.json();

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: `Edit or move Original role at ${application.company}`, exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit job" });
    const roleField = editDialog.getByLabel("Role");
    await roleField.fill("My unsaved edit");

    const remoteEdit = await request.put(`/api/applications/${application.id}`, {
      data: {
        company: application.company,
        role: "Remote version",
        status: application.status,
        appliedDate: "2026-09-22",
        revision: application.revision,
      },
      headers: sameOriginMutationHeaders,
    });
    expect(remoteEdit.status()).toBe(200);
    expect((await remoteEdit.json()).application.revision).toBe(application.revision + 1);

    const saveResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT" && response.url().endsWith(`/api/applications/${application.id}`),
    );
    await editDialog.getByRole("button", { name: "Save job", exact: true }).click();
    const conflict = await saveResponse;
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).application.role).toBe("Remote version");

    await expect(editDialog).toBeVisible();
    await expect(roleField).toHaveValue("My unsaved edit");
    await expect(editDialog.getByRole("alert")).toContainText("changed while you were editing");
    await editDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edit or move Remote version at ${application.company}`, exact: true })).toBeVisible();
  } finally {
    await request.delete(`/api/applications/${application.id}`, { headers: sameOriginMutationHeaders });
  }
});
