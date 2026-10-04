import { expect, test } from "./api-helpers";
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

test("response framing policy blocks an application embedded by another origin", async ({ page, request, context }) => {
  const targetOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL!).origin;
  const attackerUrl = `${targetOrigin.replace("127.0.0.1", "localhost")}/dashboard`;
  const response = await request.get("/dashboard");
  expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(response.headers()["x-frame-options"]).toBe("DENY");

  const blocked: string[] = [];
  page.on("console", (message) => {
    if (/Refused to (frame|display)|frame-ancestors|X-Frame-Options/i.test(message.text())) blocked.push(message.text());
  });
  const securityLog = await context.newCDPSession(page);
  await securityLog.send("Log.enable");
  securityLog.on("Log.entryAdded", ({ entry }) => {
    if (/frame-ancestors|X-Frame-Options/i.test(entry.text)) blocked.push(entry.text);
  });
  // A real loopback response keeps Chrome's local-network protection from masking framing enforcement.
  await page.goto(attackerUrl);
  await page.evaluate((target) => {
    const frame = document.createElement("iframe");
    frame.title = "Blocked Nook frame";
    frame.src = `${target}/dashboard`;
    document.body.append(frame);
  }, targetOrigin);
  await expect.poll(() => blocked.length).toBeGreaterThan(0);
  await expect(page.frameLocator('iframe[title="Blocked Nook frame"]').getByRole("heading", { name: "Dashboard", exact: true })).toHaveCount(0);
});
