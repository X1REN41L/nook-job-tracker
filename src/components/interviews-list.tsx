"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { interviewDateKey, type InterviewListItem } from "@/lib/interviews";

type InterviewTab = "upcoming" | "past";

type InterviewGroup = {
  key: string;
  label: string;
  interviews: InterviewListItem[];
};

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function endOfCurrentWeek(today: string) {
  const date = new Date(`${today}T00:00:00.000Z`);
  return addDays(today, 6 - date.getUTCDay());
}

function getGroupLabel(date: string, today: string, tab: InterviewTab, weekEnd: string) {
  if (tab === "upcoming") {
    if (date === today) return "Today";
    if (date === addDays(today, 1)) return "Tomorrow";
    if (date <= weekEnd) return "This week";
    return "Later";
  }

  if (date === addDays(today, -1)) return "Yesterday";
  const weekStart = addDays(weekEnd, -6);
  if (date >= weekStart) return "This week";
  return "Earlier";
}

function groupInterviews(interviews: InterviewListItem[], tab: InterviewTab, today: string) {
  const weekEnd = endOfCurrentWeek(today);
  const groups = new Map<string, InterviewGroup>();

  for (const interview of interviews) {
    const date = interviewDateKey(interview.date);
    const label = getGroupLabel(date, today, tab, weekEnd);
    const group = groups.get(label) ?? { key: label.toLowerCase().replaceAll(" ", "-"), label, interviews: [] };
    group.interviews.push(interview);
    groups.set(label, group);
  }

  return [...groups.values()];
}

function formatInterviewDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${interviewDateKey(value)}T00:00:00.000Z`));
}

function InterviewRow({ interview }: { interview: InterviewListItem }) {
  const date = interviewDateKey(interview.date);
  const note = interview.note?.trim();

  return (
    <article className="grid grid-cols-1 gap-x-7 gap-y-1 border-b border-line/70 py-6 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[96px_minmax(0,1fr)] md:gap-y-0">
      <time className="text-sm font-medium text-ink-soft" dateTime={date}>
        {formatInterviewDate(interview.date)}
      </time>
      <div className="min-w-0">
        <h3 className="break-words text-base font-semibold leading-6 text-ink">
          <span>{interview.role}</span>
          <span aria-hidden="true" className="mx-1.5 text-ink-soft">—</span>
          <span className="font-medium text-ink-soft">{interview.company}</span>
        </h3>
        {note && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">{note}</p>}
      </div>
    </article>
  );
}

export function InterviewsList({ interviews, upcomingCount, today }: {
  interviews: InterviewListItem[];
  upcomingCount: number;
  today: string;
}) {
  const [selectedTab, setSelectedTab] = useState<InterviewTab>("upcoming");
  const [searchQuery, setSearchQuery] = useState("");
  const upcomingTabRef = useRef<HTMLButtonElement>(null);
  const pastTabRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const query = searchQuery.trim().toLocaleLowerCase();
  const visibleInterviews = interviews
    .filter((interview) => selectedTab === "upcoming"
      ? interviewDateKey(interview.date) >= today
      : interviewDateKey(interview.date) < today)
    .filter((interview) => !query ||
      interview.role.toLocaleLowerCase().includes(query) ||
      interview.company.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const dateOrder = interviewDateKey(a.date).localeCompare(interviewDateKey(b.date));
      return selectedTab === "upcoming" ? dateOrder : -dateOrder;
    });
  const groups = groupInterviews(visibleInterviews, selectedTab, today);
  const tabListId = `${id}-tabs`;
  const panelId = `${id}-panel`;

  function focusTab(tab: InterviewTab) {
    setSelectedTab(tab);
    (tab === "upcoming" ? upcomingTabRef : pastTabRef).current?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(selectedTab === "upcoming" ? "past" : "upcoming");
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab("upcoming");
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab("past");
    }
  }

  const emptyMessage = query
    ? "No interviews match your search."
    : selectedTab === "upcoming"
      ? "All caught up — no interviews on the horizon."
      : "No past interviews.";

  return (
    <section className="mx-auto w-full max-w-5xl" aria-labelledby={`${id}-heading`}>
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight" id={`${id}-heading`}>
        {upcomingCount} Upcoming Interview
      </h1>

      <div className="mt-7 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div aria-label="Interview status" className="flex shrink-0 gap-5" id={tabListId} role="tablist">
          {(["upcoming", "past"] as const).map((tab) => (
            <button
              key={tab}
              ref={tab === "upcoming" ? upcomingTabRef : pastTabRef}
              aria-controls={panelId}
              aria-selected={selectedTab === tab}
              className={`border-b-2 px-0.5 pb-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-cream ${selectedTab === tab ? "border-forest text-forest" : "border-transparent text-ink-soft hover:text-ink"}`}
              id={`${id}-${tab}-tab`}
              onClick={() => setSelectedTab(tab)}
              onKeyDown={handleTabKeyDown}
              role="tab"
              tabIndex={selectedTab === tab ? 0 : -1}
              type="button"
            >
              {tab === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>

        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Search by company or role</span>
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="input pl-9 text-sm"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by company or role"
            type="search"
            value={searchQuery}
          />
        </label>
      </div>

      <div aria-labelledby={`${id}-${selectedTab}-tab`} className="pb-10 pt-7" id={panelId} role="tabpanel" tabIndex={0}>
        {groups.length === 0 ? (
          <p className="py-8 text-sm text-ink-soft">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col gap-9 sm:gap-12">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`${id}-${group.key}-heading`}>
                <h2 className="mb-5 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-forest" id={`${id}-${group.key}-heading`}>
                  {group.label}
                </h2>
                <div>
                  {group.interviews.map((interview) => <InterviewRow key={interview.id} interview={interview} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
