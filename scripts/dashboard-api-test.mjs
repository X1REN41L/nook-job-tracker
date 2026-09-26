import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const origin = new URL(base).origin;
const headers = { Origin: origin, "Content-Type": "application/json" };
const prisma = new PrismaClient();
const createdIds = [];
const today = new Date().toISOString().slice(0, 10);

function shiftDate(key, offset) {
  const date = new Date(key + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function previousMonth(key) {
  const date = new Date(key + "T00:00:00.000Z");
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthOffset(key, offset) {
  const date = new Date(key + "T00:00:00.000Z");
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7) + "-01";
}

async function applicationsFor(startDate, endDate) {
  return prisma.application.findMany({
    where: {
      appliedDate: {
        gte: new Date(startDate + "T00:00:00.000Z"),
        lt: new Date(shiftDate(endDate, 1) + "T00:00:00.000Z"),
      },
    },
    select: { id: true, status: true, appliedDate: true, archived: true, events: { select: { fromStatus: true, toStatus: true } } },
  });
}

function assertRateValues(response, metricNames) {
  for (const name of metricNames) {
    const metric = response[name];
    assert.ok(Number.isInteger(metric.numerator) && Number.isInteger(metric.denominator));
    assert.ok(metric.numerator >= 0 && metric.numerator <= metric.denominator);
    assert.ok(Number.isFinite(metric.percentage) && metric.percentage >= 0 && metric.percentage <= 100);
    assert.equal(metric.historyCoverage.totalApplications, metric.denominator);
    assert.equal(metric.historyCoverage.completeApplications + metric.historyCoverage.incompleteApplications, metric.denominator);
    assert.ok(Number.isFinite(metric.historyCoverage.percentageComplete));
  }
}

async function json(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path + " should return 200");
  return response.json();
}

async function createApplication({ role, status = "APPLIED", appliedDate = today, interviewDate }) {
  const response = await fetch(base + "/api/applications", {
    method: "POST",
    headers,
    body: JSON.stringify({
      company: "Dashboard API test",
      role,
      status,
      appliedDate,
      interviewDate,
    }),
  });
  assert.equal(response.status, 201, "application create should succeed");
  const application = (await response.json()).application;
  createdIds.push(application.id);
  return application;
}

async function changeStatus(application, status) {
  const response = await fetch(base + "/api/applications/" + application.id, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ revision: application.revision, status }),
  });
  assert.equal(response.status, 200, "status change should succeed");
  return (await response.json()).application;
}

async function setStatusEventAge(applicationId, days) {
  const event = await prisma.applicationEvent.findFirst({
    where: { applicationId, type: "STATUS_CHANGE" },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(event, "application should have its initial status event");
  await prisma.applicationEvent.update({
    where: { id: event.id },
    data: { createdAt: new Date(Date.now() - days * 86_400_000) },
  });
}

try {
  const emptyOverview = await json("/api/dashboard/overview?today=" + today);
  assert.equal(emptyOverview.totalApplications, 0);
  assert.equal(emptyOverview.activePipeline, 0);
  assert.equal(emptyOverview.upcomingInterviews.count, 0);
  assert.deepEqual(emptyOverview.upcomingInterviews.items, []);
  assert.equal(emptyOverview.interviewRate.denominator, 0);
  assert.equal(emptyOverview.interviewRate.percentage, 0);
  assert.equal(emptyOverview.interviewRate.historyCoverage.totalApplications, 0);
  assertRateValues(emptyOverview, ["interviewRate", "offerRate"]);
  assert.deepEqual(emptyOverview.staleApplications, []);
  assert.deepEqual(emptyOverview.staleTimingCoverage, {
    applicationsInScope: 0, withReliableStatusTimestamp: 0, withoutReliableStatusTimestamp: 0, isComplete: true,
  });
  const emptyStale = await json("/api/dashboard/stale");
  assert.deepEqual(emptyStale.counts, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, total: 0 });
  assert.equal(emptyStale.timingCoverage.isComplete, true);
  const emptyAnalytics = await json("/api/dashboard/analytics?today=" + today);
  assert.deepEqual(emptyAnalytics.statusBreakdown,
    { APPLIED: 0, ONLINE_ASSESSMENT: 0, INTERVIEW: 0, OFFER: 0, REJECTED: 0 });
  assert.equal(emptyAnalytics.interviewRate.percentage, 0);
  assertRateValues(emptyAnalytics, ["interviewRate", "offerRate", "rejectionRate"]);

  const milestone = await createApplication({ role: "Milestone history" });
  const singleOverview = await json("/api/dashboard/overview?today=" + today);
  assert.equal(singleOverview.totalApplications, 1);
  assert.equal(singleOverview.interviewRate.denominator, 1);
  assert.equal(singleOverview.interviewRate.numerator, 0);
  assert.equal(singleOverview.interviewRate.percentage, 0);
  assert.equal(singleOverview.interviewRate.historyCoverage.completeApplications, 1);
  const unchanged = await changeStatus(milestone, "APPLIED");
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId: milestone.id, type: "STATUS_CHANGE" } }), 1,
    "A same-status update must not add a transition event");
  let moved = await changeStatus(unchanged, "INTERVIEW");
  moved = await changeStatus(moved, "OFFER");
  moved = await changeStatus(moved, "APPLIED");
  moved = await changeStatus(moved, "INTERVIEW");
  moved = await changeStatus(moved, "APPLIED");
  const statusEvents = await prisma.applicationEvent.findMany({
    where: { applicationId: milestone.id, type: "STATUS_CHANGE" },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(statusEvents.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]), [
    [null, "APPLIED"], ["APPLIED", "INTERVIEW"], ["INTERVIEW", "OFFER"], ["OFFER", "APPLIED"],
    ["APPLIED", "INTERVIEW"], ["INTERVIEW", "APPLIED"],
  ]);

  for (const archived of [true, false, true]) {
    const response = await fetch(base + "/api/applications/" + milestone.id, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ revision: moved.revision, archived }),
    });
    assert.equal(response.status, 200);
    moved = (await response.json()).application;
  }
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId: milestone.id } }), 6, "Archive and restore must not add status events");

  await createApplication({ role: "Today interview", interviewDate: today });
  await createApplication({ role: "Tomorrow interview", status: "INTERVIEW", interviewDate: shiftDate(today, 1) });
  await createApplication({ role: "Same date interview", interviewDate: shiftDate(today, 1) });
  await createApplication({ role: "Third interview", interviewDate: shiftDate(today, 3) });
  await createApplication({ role: "Fourth interview", interviewDate: shiftDate(today, 5) });
  const terminalOffer = await createApplication({ role: "Offer with interview date", status: "OFFER", interviewDate: shiftDate(today, 1) });
  await createApplication({ role: "Rejected with interview date", status: "REJECTED", interviewDate: today });

  const stale20 = await createApplication({ role: "Stale 20 days" });
  const stale21 = await createApplication({ role: "Stale 21 days" });
  const stale29 = await createApplication({ role: "Stale 29 days" });
  const stale30 = await createApplication({ role: "Stale 30 days", status: "ONLINE_ASSESSMENT" });
  const stale59 = await createApplication({ role: "Stale 59 days" });
  const stale60 = await createApplication({ role: "Stale 60 days", status: "INTERVIEW" });
  const archivedStale = await createApplication({ role: "Archived stale" });
  const archivedResponse = await fetch(base + "/api/applications/" + archivedStale.id, {
    method: "PATCH", headers, body: JSON.stringify({ revision: archivedStale.revision, archived: true }),
  });
  assert.equal(archivedResponse.status, 200);
  const staleOffer = await createApplication({ role: "Terminal stale offer", status: "OFFER" });

  await setStatusEventAge(stale20.id, 20);
  await setStatusEventAge(stale21.id, 21);
  await setStatusEventAge(stale29.id, 29);
  await setStatusEventAge(stale30.id, 30);
  await setStatusEventAge(stale59.id, 59);
  await setStatusEventAge(stale60.id, 60);
  await setStatusEventAge(archivedStale.id, 60);
  await setStatusEventAge(staleOffer.id, 60);
  await setStatusEventAge(terminalOffer.id, 70);

  const selectedMonth = previousMonth(today);
  await createApplication({ role: "Selected month rejected", status: "REJECTED", appliedDate: selectedMonth + "-05" });
  await createApplication({ role: "Selected month interview", status: "INTERVIEW", appliedDate: selectedMonth + "-20" });
  const previousYear = String(Number(today.slice(0, 4)) - 1);
  await createApplication({ role: "Selected year offer", status: "OFFER", appliedDate: previousYear + "-05-12" });

  const legacyId = randomUUID();
  const legacyEventId = randomUUID();
  const createdAt = new Date().toISOString();
  const backup = {
    version: 2,
    settings: { theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false },
    applications: [{
      id: legacyId,
      company: "Dashboard API test",
      role: "Imported incomplete history",
      status: "APPLIED",
      archived: false,
      source: null,
      appliedDate: today + "T00:00:00.000Z",
      interviewDate: null,
      interviewDatePromptDismissed: true,
      notes: null,
      jobUrl: null,
      createdAt,
      lastUpdated: createdAt,
      events: [{
        id: legacyEventId,
        type: "STATUS_CHANGE",
        detail: "OFFER → APPLIED",
        emailSnippet: null,
        createdAt,
      }],
    }],
  };
  const importResponse = await fetch(base + "/api/applications/import", {
    method: "POST", headers, body: JSON.stringify(backup),
  });
  assert.equal(importResponse.status, 201, await importResponse.clone().text());
  createdIds.push(legacyId);
  const exported = await json("/api/applications/export");
  const exportedLegacy = exported.applications.find(({ id }) => id === legacyId);
  assert.equal(exportedLegacy.events[0].fromStatus, "OFFER", "Legacy detail should be safely parsed on import");
  assert.equal(exportedLegacy.events[0].toStatus, "APPLIED");

  const malformedId = randomUUID();
  const malformedBackup = structuredClone(backup);
  malformedBackup.applications[0].id = malformedId;
  malformedBackup.applications[0].role = "Invalid imported history";
  malformedBackup.applications[0].events[0] = {
    ...malformedBackup.applications[0].events[0],
    id: randomUUID(),
    fromStatus: "INTERVIEW",
    toStatus: "OFFER",
  };
  const invalidHistory = await fetch(base + "/api/applications/import", {
    method: "POST", headers, body: JSON.stringify(malformedBackup),
  });
  assert.equal(invalidHistory.status, 400, "Typed event data that disagrees with its display detail must be rejected");

  const inconsistentId = randomUUID();
  const inconsistentBackup = structuredClone(backup);
  inconsistentBackup.applications[0].id = inconsistentId;
  inconsistentBackup.applications[0].status = "REJECTED";
  inconsistentBackup.applications[0].events = [
    { id: randomUUID(), type: "STATUS_CHANGE", detail: "APPLIED → INTERVIEW", fromStatus: "APPLIED", toStatus: "INTERVIEW", emailSnippet: null, createdAt },
    { id: randomUUID(), type: "STATUS_CHANGE", detail: "OFFER → REJECTED", fromStatus: "OFFER", toStatus: "REJECTED", emailSnippet: null, createdAt },
  ];
  const disconnectedHistory = await fetch(base + "/api/applications/import", {
    method: "POST", headers, body: JSON.stringify(inconsistentBackup),
  });
  assert.equal(disconnectedHistory.status, 400, "Equal-time typed events must still form a connected transition chain");

  const missingTiming = await createApplication({ role: "Missing reliable status timestamp" });
  await prisma.applicationEvent.deleteMany({ where: { applicationId: missingTiming.id, type: "STATUS_CHANGE" } });

  const overview = await json("/api/dashboard/overview?today=" + today);
  assert.equal(overview.totalApplications, createdIds.length);
  assert.equal(overview.activePipeline, await prisma.application.count({
    where: { archived: false, status: { in: ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW"] } },
  }), "Active pipeline excludes archived and terminal applications");
  assert.equal(overview.upcomingInterviews.count, 5);
  assert.deepEqual(overview.upcomingInterviews.items.map(({ interviewDate }) => interviewDate), [today, shiftDate(today, 1), shiftDate(today, 1)]);
  assert.deepEqual(overview.upcomingInterviews.items.slice(1).map(({ id }) => id),
    [createdIds[2], createdIds[3]].sort(), "Equal interview dates use deterministic ID ordering");
  assert.equal(overview.upcomingInterviews.items[0].daysUntilInterview, 0, "An interview today is upcoming");
  assert.equal(overview.interviewRate.numerator, 4, "Interview milestones remain counted after moving away from Interview");
  assert.equal(overview.interviewRate.denominator, createdIds.length);
  assert.equal(overview.offerRate.numerator, 5, "Archived and historical Offer milestones remain counted");
  assert.equal(overview.interviewRate.historyCoverage.totalApplications, createdIds.length);
  assertRateValues(overview, ["interviewRate", "offerRate"]);
  assert.equal(overview.interviewRate.historyCoverage.completeApplications + overview.interviewRate.historyCoverage.incompleteApplications, createdIds.length);
  assert.ok(overview.interviewRate.historyCoverage.incompleteApplications >= 1);
  assert.equal(overview.interviewRate.historyCoverage.isComplete, false);
  assert.deepEqual(overview.staleApplications.map(({ severity }) => severity), ["CRITICAL", "HIGH", "HIGH"]);
  assert.deepEqual(overview.staleApplications.map(({ id }) => id), [stale60.id, stale59.id, stale30.id]);
  assert.equal(overview.staleApplications[0].staleDays, 60);
  assert.equal(overview.staleTimingCoverage.withoutReliableStatusTimestamp, 1);
  assert.equal(overview.staleTimingCoverage.isComplete, false);

  const stale = await json("/api/dashboard/stale");
  assert.deepEqual(stale.counts, { CRITICAL: 1, HIGH: 2, MEDIUM: 2, total: 5 });
  assert.equal(stale.applicationsBySeverity.CRITICAL[0].id, stale60.id);
  assert.deepEqual(stale.applicationsBySeverity.HIGH.map(({ id }) => id), [stale59.id, stale30.id]);
  assert.deepEqual(stale.applicationsBySeverity.MEDIUM.map(({ id }) => id), [stale29.id, stale21.id]);
  assert.deepEqual(stale.applications.map(({ id, staleDays, severity }) => [id, staleDays, severity]), [
    [stale60.id, 60, "CRITICAL"], [stale59.id, 59, "HIGH"], [stale30.id, 30, "HIGH"],
    [stale29.id, 29, "MEDIUM"], [stale21.id, 21, "MEDIUM"],
  ]);
  assert.deepEqual(stale.top.map(({ id }) => id), overview.staleApplications.map(({ id }) => id));
  assert.equal(stale.applications.some(({ id }) => id === stale20.id || id === archivedStale.id || id === staleOffer.id || id === missingTiming.id), false);
  assert.equal(stale.timingCoverage.withoutReliableStatusTimestamp, 1);
  assert.equal(stale.timingCoverage.isComplete, false);

  const currentMonth = await json("/api/dashboard/analytics?today=" + today);
  assert.equal(currentMonth.period, "CURRENT_MONTH");
  assert.equal(currentMonth.range.startDate, today.slice(0, 7) + "-01");
  assert.equal(currentMonth.applications, (await applicationsFor(currentMonth.range.startDate, currentMonth.range.endDate)).length,
    "Current month uses the explicit calendar date and appliedDate");
  assert.deepEqual(Object.keys(currentMonth.statusBreakdown).sort(), ["APPLIED", "INTERVIEW", "OFFER", "ONLINE_ASSESSMENT", "REJECTED"]);
  assert.equal(currentMonth.applicationsTrend.granularity, "WEEK");
  assert.equal(currentMonth.applicationsTrend.buckets.reduce((sum, bucket) => sum + bucket.count, 0), currentMonth.applications);
  assert.equal(currentMonth.applicationsTrend.buckets.some(({ count }) => count === 0), true, "Trend includes empty week buckets");

  const lastThree = await json("/api/dashboard/analytics?period=LAST_3_MONTHS&today=" + today);
  const lastThreeStart = monthOffset(today, -2);
  assert.equal(lastThree.range.startDate, lastThreeStart);
  assert.equal(lastThree.range.endDate, today);
  assert.equal(lastThree.applications, (await applicationsFor(lastThree.range.startDate, lastThree.range.endDate)).length,
    "Last three months use three calendar months through the explicit date");
  assert.equal(lastThree.applicationsTrend.granularity, "MONTH");
  assert.equal(lastThree.applicationsTrend.buckets.length, 3);

  const customMonth = await json("/api/dashboard/analytics?period=CUSTOM_MONTH&month=" + selectedMonth);
  assert.equal(customMonth.applications, 2);
  assert.equal(customMonth.statusBreakdown.REJECTED, 1);
  assert.equal(customMonth.statusBreakdown.INTERVIEW, 1);
  assert.equal(customMonth.interviewRate.numerator, 1);
  assert.equal(customMonth.rejectionRate.numerator, 1);
  assert.equal(customMonth.applicationsTrend.buckets.reduce((sum, bucket) => sum + bucket.count, 0), 2);

  const customYear = await json("/api/dashboard/analytics?period=CUSTOM_YEAR&year=" + previousYear);
  const previousYearRows = await applicationsFor(previousYear + "-01-01", previousYear + "-12-31");
  assert.equal(customYear.applications, previousYearRows.length);
  assert.equal(customYear.statusBreakdown.OFFER, previousYearRows.filter(({ status }) => status === "OFFER").length);
  assert.equal(customYear.offerRate.numerator, previousYearRows.filter((application) => application.status === "OFFER" || application.events.some((event) =>
    event.fromStatus === "OFFER" || event.toStatus === "OFFER")).length);
  assert.equal(customYear.applicationsTrend.buckets.length, 12);
  assert.equal(customYear.applicationsTrend.buckets.reduce((sum, bucket) => sum + bucket.count, 0), 1);

  const currentYear = await json("/api/dashboard/analytics?period=CURRENT_YEAR&today=" + today);
  assert.equal(currentYear.range.startDate, today.slice(0, 4) + "-01-01");
  assert.equal(currentYear.range.endDate, today);
  assert.equal(currentYear.applications, (await applicationsFor(currentYear.range.startDate, currentYear.range.endDate)).length);
  assert.equal(currentYear.applicationsTrend.granularity, "MONTH");
  assertRateValues(currentMonth, ["interviewRate", "offerRate", "rejectionRate"]);

  const tiedValidId = randomUUID();
  const tiedValidBackup = structuredClone(backup);
  tiedValidBackup.applications[0].id = tiedValidId;
  tiedValidBackup.applications[0].role = "Valid equal-time typed chain";
  tiedValidBackup.applications[0].status = "INTERVIEW";
  tiedValidBackup.applications[0].appliedDate = "2020-01-01T00:00:00.000Z";
  tiedValidBackup.applications[0].events = [
    { id: randomUUID(), type: "STATUS_CHANGE", detail: "null → APPLIED", fromStatus: null, toStatus: "APPLIED", emailSnippet: null, createdAt },
    { id: randomUUID(), type: "STATUS_CHANGE", detail: "APPLIED → INTERVIEW", fromStatus: "APPLIED", toStatus: "INTERVIEW", emailSnippet: null, createdAt },
  ];
  const validTiedChain = await fetch(base + "/api/applications/import", {
    method: "POST", headers, body: JSON.stringify(tiedValidBackup),
  });
  assert.equal(validTiedChain.status, 201, "Equal-time transitions are accepted when they form a valid chain");
  createdIds.push(tiedValidId);

  assert.equal((await fetch(base + "/api/dashboard/analytics?period=CUSTOM_MONTH")).status, 400);
  assert.equal((await fetch(base + "/api/dashboard/analytics?period=CUSTOM_YEAR&month=2026-01&year=2026")).status, 400);
  assert.equal((await fetch(base + "/api/dashboard/overview?today=2026-02-30")).status, 400);
  assert.equal((await fetch(base + "/api/dashboard/overview")).status, 400, "Overview requires an explicit calendar date");
  assert.equal((await fetch(base + "/api/dashboard/analytics?today=2026-02-30")).status, 400);
  assert.equal((await fetch(base + "/api/dashboard/analytics?period=CUSTOM_MONTH&month=2026-13")).status, 400);
  assert.equal((await fetch(base + "/api/dashboard/analytics?period=CUSTOM_YEAR&year=20x6")).status, 400);

  await createApplication({ role: "November 2025 cohort", status: "INTERVIEW", appliedDate: "2025-11-01" });
  const decemberCohort = await createApplication({ role: "December 2025 cohort", status: "REJECTED", appliedDate: "2025-12-31", interviewDate: "2026-01-01" });
  await createApplication({ role: "January 2026 cohort", status: "OFFER", appliedDate: "2026-01-01", interviewDate: "2026-01-01" });
  const februaryCohort = await createApplication({ role: "Future February cohort", appliedDate: "2026-02-01", interviewDate: "2026-02-01" });
  const calendarMeeting = await createApplication({ role: "Calendar boundary interview", appliedDate: "2025-12-30", interviewDate: "2026-01-01" });
  const archiveDecember = await fetch(base + "/api/applications/" + decemberCohort.id, {
    method: "PATCH", headers, body: JSON.stringify({ revision: decemberCohort.revision, archived: true }),
  });
  assert.equal(archiveDecember.status, 200);

  const janFirstOverview = await json("/api/dashboard/overview?today=2026-01-01");
  const janMeeting = janFirstOverview.upcomingInterviews.items.find(({ id }) => id === calendarMeeting.id);
  assert.ok(janMeeting, "The exact supplied calendar date is included as an upcoming interview day");
  assert.equal(janMeeting.daysUntilInterview, 0);
  const decLastOverview = await json("/api/dashboard/overview?today=2025-12-31");
  assert.equal(decLastOverview.upcomingInterviews.items.find(({ id }) => id === calendarMeeting.id)?.daysUntilInterview, 1,
    "Calendar-day arithmetic crosses local month/year boundaries without timezone conversion");
  assert.ok(janFirstOverview.upcomingInterviews.items.some(({ id }) => id === februaryCohort.id));

  const janCurrentMonth = await json("/api/dashboard/analytics?today=2026-01-01");
  assert.deepEqual(janCurrentMonth.range, { startDate: "2026-01-01", endDate: "2026-01-01" });
  assert.equal(janCurrentMonth.applicationsTrend.buckets.length, 5);
  assert.equal(janCurrentMonth.applicationsTrend.buckets[0].startDate, "2026-01-01");
  assert.equal(janCurrentMonth.applicationsTrend.buckets.at(-1).endDate, "2026-01-31");
  assert.equal(janCurrentMonth.applications, (await applicationsFor("2026-01-01", "2026-01-01")).length,
    "Future appliedDate values are excluded from current-period cohorts");
  assert.equal(janCurrentMonth.statusBreakdown.OFFER,
    (await applicationsFor("2026-01-01", "2026-01-01")).filter(({ status }) => status === "OFFER").length);
  const janCurrentYear = await json("/api/dashboard/analytics?period=CURRENT_YEAR&today=2026-01-01");
  assert.deepEqual(janCurrentYear.range, { startDate: "2026-01-01", endDate: "2026-01-01" });
  assert.equal(janCurrentYear.applicationsTrend.buckets.length, 1);
  assert.equal(janCurrentYear.applicationsTrend.buckets[0].endDate, "2026-01-31");
  const marchCurrentYear = await json("/api/dashboard/analytics?period=CURRENT_YEAR&today=2001-03-31");
  assert.deepEqual(marchCurrentYear.range, { startDate: "2001-01-01", endDate: "2001-03-31" });
  assert.equal(marchCurrentYear.applicationsTrend.buckets.length, 3);
  assert.deepEqual(marchCurrentYear.applicationsTrend.buckets.map(({ count }) => count), [0, 0, 0],
    "Monthly trend includes all zero-count months");

  const janLastThree = await json("/api/dashboard/analytics?period=LAST_3_MONTHS&today=2026-01-01");
  assert.deepEqual(janLastThree.range, { startDate: "2025-11-01", endDate: "2026-01-01" });
  assert.deepEqual(janLastThree.applicationsTrend.buckets.map(({ startDate }) => startDate),
    ["2025-11-01", "2025-12-01", "2026-01-01"]);
  assert.deepEqual(janLastThree.applicationsTrend.buckets.map(({ startDate, endDate }) => [startDate, endDate]), [
    ["2025-11-01", "2025-11-30"], ["2025-12-01", "2025-12-31"], ["2026-01-01", "2026-01-31"],
  ]);
  const janCohortRows = await applicationsFor("2025-11-01", "2026-01-01");
  assert.equal(janLastThree.applications, janCohortRows.length);
  for (const status of ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"]) {
    assert.equal(janLastThree.statusBreakdown[status], janCohortRows.filter((application) => application.status === status).length,
      "Status breakdown groups the appliedDate cohort by current status, including archived records");
  }
  for (const [metric, status] of [["interviewRate", "INTERVIEW"], ["offerRate", "OFFER"], ["rejectionRate", "REJECTED"]]) {
    const numerator = janCohortRows.filter((application) => application.status === status || application.events.some((event) =>
      event.fromStatus === status || event.toStatus === status)).length;
    assert.equal(janLastThree[metric].numerator, numerator);
    assert.equal(janLastThree[metric].denominator, janCohortRows.length);
    assert.equal(janLastThree[metric].historyCoverage.totalApplications, janCohortRows.length);
    assert.equal(janLastThree[metric].historyCoverage.completeApplications + janLastThree[metric].historyCoverage.incompleteApplications,
      janCohortRows.length);
  }
  const decemberCustomMonth = await json("/api/dashboard/analytics?period=CUSTOM_MONTH&month=2025-12");
  assert.deepEqual(decemberCustomMonth.range, { startDate: "2025-12-01", endDate: "2025-12-31" });
  assert.equal(decemberCustomMonth.applications, (await applicationsFor("2025-12-01", "2025-12-31")).length);
  const decemberWeeks = decemberCustomMonth.applicationsTrend.buckets;
  assert.equal(decemberWeeks[0].startDate, "2025-12-01");
  assert.equal(decemberWeeks.at(-1).endDate, "2025-12-31");
  for (let index = 1; index < decemberWeeks.length; index += 1) {
    assert.equal(decemberWeeks[index].startDate, shiftDate(decemberWeeks[index - 1].endDate, 1),
      "Weekly buckets must be contiguous across month boundaries");
  }
  const custom2025 = await json("/api/dashboard/analytics?period=CUSTOM_YEAR&year=2025");
  assert.deepEqual(custom2025.range, { startDate: "2025-01-01", endDate: "2025-12-31" });
  assert.equal(custom2025.applications, (await applicationsFor("2025-01-01", "2025-12-31")).length);
  assert.equal(custom2025.applicationsTrend.buckets.length, 12);

  const yearZeroPadded = await json("/api/dashboard/analytics?period=CUSTOM_MONTH&month=0004-02");
  assert.deepEqual(yearZeroPadded.range, { startDate: "0004-02-01", endDate: "0004-02-29" },
    "Custom calendar dates handle years below 0100 and leap February correctly");
  const yearZeroPaddedAnnual = await json("/api/dashboard/analytics?period=CUSTOM_YEAR&year=0004");
  assert.deepEqual(yearZeroPaddedAnnual.range, { startDate: "0004-01-01", endDate: "0004-12-31" });
  assert.equal(yearZeroPaddedAnnual.applicationsTrend.buckets.length, 12);
  const earlyCalendarYear = await json("/api/dashboard/analytics?today=0004-02-29");
  assert.deepEqual(earlyCalendarYear.range, { startDate: "0004-02-01", endDate: "0004-02-29" });

  const allTimeBeforeArchive = await json("/api/dashboard/overview?today=" + today);
  const currentCohortBeforeArchive = await json("/api/dashboard/analytics?today=" + today);
  await prisma.application.updateMany({ where: { id: { in: createdIds } }, data: { archived: true } });
  const allArchivedOverview = await json("/api/dashboard/overview?today=" + today);
  assert.equal(allArchivedOverview.totalApplications, createdIds.length);
  assert.equal(allArchivedOverview.activePipeline, 0);
  assert.equal(allArchivedOverview.upcomingInterviews.count, 0);
  assert.equal(allArchivedOverview.interviewRate.denominator, createdIds.length);
  assert.equal(allArchivedOverview.interviewRate.numerator, allTimeBeforeArchive.interviewRate.numerator);
  assert.equal(allArchivedOverview.offerRate.numerator, allTimeBeforeArchive.offerRate.numerator);
  assert.deepEqual(allArchivedOverview.staleTimingCoverage, {
    applicationsInScope: 0, withReliableStatusTimestamp: 0, withoutReliableStatusTimestamp: 0, isComplete: true,
  });
  const allArchivedStale = await json("/api/dashboard/stale");
  assert.deepEqual(allArchivedStale.counts, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, total: 0 });
  const allArchivedAnalytics = await json("/api/dashboard/analytics?today=" + today);
  assert.equal(allArchivedAnalytics.applications, currentCohortBeforeArchive.applications,
    "Analytics cohort metrics include archived applications");

  console.log("Passed: zero/one/all-archived states, typed and repeated transitions, imported chain validation, rate coverage, explicit calendar dates, interview ordering, stale thresholds/order/coverage, exact cohorts, status breakdown, and zero-filled trends.");
} finally {
  if (createdIds.length) await prisma.application.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
}
