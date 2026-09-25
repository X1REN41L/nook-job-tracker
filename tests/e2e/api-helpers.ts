const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
if (!baseUrl) throw new Error("PLAYWRIGHT_BASE_URL is required for API mutation tests");

export const sameOriginMutationHeaders = {
  Origin: new URL(baseUrl).origin,
  "Content-Type": "application/json",
};
