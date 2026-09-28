import assert from "node:assert/strict";
import test from "node:test";
import { compareApplications, matchesApplicationSearch } from "../src/lib/application-list.ts";

test("search trims the query and matches across company and role", () => {
  const application = { company: "Acme Corp", role: "Engineer" };
  assert.equal(matchesApplicationSearch(application, " acme "), true);
  assert.equal(matchesApplicationSearch(application, "Corp Engineer"), true);
  assert.equal(matchesApplicationSearch(application, "engineer"), true);
  assert.equal(matchesApplicationSearch(application, "other"), false);
});

test("client order matches the API's appliedDate and createdAt descending order", () => {
  const rows = [
    { appliedDate: "2026-09-28T00:00:00.000Z", createdAt: "2026-09-28T10:00:00.000Z" },
    { appliedDate: "2026-09-29T00:00:00.000Z", createdAt: "2026-09-28T09:00:00.000Z" },
    { appliedDate: "2026-09-28T00:00:00.000Z", createdAt: "2026-09-28T12:00:00.000Z" },
  ];
  assert.deepEqual([...rows].sort(compareApplications), [rows[1], rows[2], rows[0]]);
});
