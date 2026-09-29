import { randomUUID } from "node:crypto";


import { expect, openDetailsEditor, test, sameOriginMutationHeaders } from "./api-helpers";

test("keeps the details editor open and refreshes the record after a stale save", async ({ page, request }) => {
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
    await page.goto("/jobs");
    await page.getByRole("button", { name: "Settings" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: `Open or move Original role at ${application.company}`, exact: true }).click();
    const editor = await openDetailsEditor(page);
    const roleField = editor.getByLabel("Role");
    await roleField.fill("My unsaved edit");

    const remoteEdit = await request.put(`/api/applications/${application.id}`, {
      data: {
        company: application.company,
        role: "Remote version",
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
    await editor.getByRole("button", { name: "Save details", exact: true }).click();
    const conflict = await saveResponse;
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).application.role).toBe("Remote version");

    await expect(editor).toBeVisible();
    await expect(roleField).toHaveValue("My unsaved edit");
    await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Remote version", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: `Open or move Remote version at ${application.company}`, exact: true })).toBeVisible();
  } finally {
    await request.delete(`/api/applications/${application.id}`, { headers: sameOriginMutationHeaders });
  }
});
