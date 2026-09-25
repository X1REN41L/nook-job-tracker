import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("a browser request from a different origin cannot create an application", async ({ page, request }) => {
  const targetOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL!).origin;
  const attackerOrigin = targetOrigin.replace("127.0.0.1", "localhost");
  expect(attackerOrigin).not.toBe(targetOrigin);

  const company = `Cross-origin blocked ${randomUUID()}`;
  await page.goto(attackerOrigin);
  const responseType = await page.evaluate(async ({ targetOrigin, payload }) => {
    const response = await fetch(`${targetOrigin}/api/applications`, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    return response.type;
  }, {
    targetOrigin,
    payload: { company, role: "Must not be saved", status: "APPLIED", appliedDate: "2026-09-25" },
  });

  expect(responseType).toBe("opaque");
  const { applications } = await (await request.get("/api/applications")).json();
  expect(applications.some((application: { company: string }) => application.company === company)).toBe(false);
});
