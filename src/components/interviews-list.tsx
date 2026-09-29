"use client";

import { useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { compareInterviews, formatInterviewTime, groupUpcomingInterviews, interviewDateKey, INTERVIEW_TYPE_LABELS, type InterviewListItem } from "@/lib/interviews";
import { matchesApplicationSearch } from "@/lib/application-list";
import { formatCalendarDate } from "@/lib/application-date";
import { downloadCalendar, type CalendarInterview } from "@/lib/ics";

const toCalendar = (interview: InterviewListItem): CalendarInterview => ({ ...interview, notes: interview.note });

type InterviewTab = "upcoming" | "past";

function InterviewRow({ interview, onOpen }: { interview: InterviewListItem; onOpen: (id: string) => void }) {
  const date = interviewDateKey(interview.date);
  const note = interview.note?.trim();

  return (
    <article className="border-b border-line/70 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="relative grid grid-cols-1 gap-x-7 gap-y-1 rounded-nook-sm py-3 pl-2 pr-16 motion-interactive hover:bg-cream-2 md:grid-cols-[96px_minmax(0,1fr)] md:gap-y-0">
        <p className="text-sm font-medium text-ink-soft">
          <time dateTime={date}>{formatCalendarDate(interview.date)}</time>
          {interview.time && <span className="block text-xs font-normal">{formatInterviewTime(interview.time)}</span>}
        </p>
        <div className="min-w-0">
          <h3 className="break-words text-[clamp(1rem,calc(0.95rem_+_0.05vw),1.125rem)] font-semibold leading-6 text-ink">
            {/* The button's click area stretches over the whole row. */}
            <button
              className="text-left after:absolute after:inset-0 after:rounded-nook-sm focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-forest"
              onClick={() => onOpen(interview.applicationId)}
              type="button"
            >
              <span>{interview.role}</span>
              <span aria-hidden="true" className="mx-1.5 text-ink-soft">—</span>
              <span className="font-medium text-ink-soft">{interview.company}</span>
            </button>
          </h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            {INTERVIEW_TYPE_LABELS[interview.type]}{interview.interviewers && ` · With ${interview.interviewers}`}
          </p>
          {note && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">{note}</p>}
        </div>
        <button
          aria-label={`Add the ${interview.company} interview on ${formatCalendarDate(interview.date)} to your calendar`}
          className="absolute right-2 top-3 z-10 rounded-nook-sm px-2 py-1 text-xs font-medium text-forest motion-interactive hover:bg-forest-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
          onClick={() => downloadCalendar(`interview-${date}.ics`, [toCalendar(interview)])}
          title="Download an .ics calendar file"
          type="button"
        >
          .ics
        </button>
      </div>
    </article>
  );
}

export function InterviewsList({ interviews, upcomingCount, today, searchInputRef, onOpen }: {
  interviews: InterviewListItem[];
  upcomingCount: number;
  today: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpen: (applicationId: string) => void;
}) {
  const [selectedTab, setSelectedTab] = useState<InterviewTab>("upcoming");
  const [searchQuery, setSearchQuery] = useState("");
  const [pastSort, setPastSort] = useState<"recent" | "oldest">("recent");
  const id = useId();
  const upcomingTabRef = useRef<HTMLButtonElement>(null);
  const pastTabRef = useRef<HTMLButtonElement>(null);

  const query = searchQuery.trim();
  const upcoming = interviews
    .filter((interview) => interviewDateKey(interview.date) >= today && matchesApplicationSearch(interview, query));
  const past = interviews
    .filter((interview) => interviewDateKey(interview.date) < today && matchesApplicationSearch(interview, query))
    .sort((a, b) => (pastSort === "recent" ? -1 : 1) * compareInterviews(a, b));
  const groups = groupUpcomingInterviews(upcoming, today);
  const panelId = `${id}-panel`;

  function focusTab(tab: InterviewTab) {
    setSelectedTab(tab);
    (tab === "upcoming" ? upcomingTabRef : pastTabRef).current?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Home") {
      event.preventDefault();
      focusTab("upcoming");
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab("past");
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(selectedTab === "upcoming" ? "past" : "upcoming");
    }
  }

  return (
    <section className="w-full min-w-0" aria-labelledby={`${id}-heading`}>
      <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id={`${id}-heading`}>
        Interviews
      </h1>

      <div className="mt-7 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div aria-label="Interview status" className="flex shrink-0 gap-5" role="tablist">
          {(["upcoming", "past"] as const).map((tab) => (
            <button
              key={tab}
              ref={tab === "upcoming" ? upcomingTabRef : pastTabRef}
              aria-controls={panelId}
              aria-selected={selectedTab === tab}
              className={`border-b-2 px-0.5 pb-2 text-sm font-semibold motion-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-cream ${selectedTab === tab ? "border-forest text-forest" : "border-transparent text-ink-soft hover:text-ink"}`}
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
            ref={searchInputRef}
            className="input pl-9 text-sm"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by company or role"
            type="search"
            value={searchQuery}
          />
        </label>
      </div>

      <div aria-labelledby={`${id}-${selectedTab}-tab`} className="pb-10 pt-7" id={panelId} role="tabpanel">
        {selectedTab === "upcoming" ? (
          <section aria-labelledby={`${id}-upcoming-heading`}>
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-serif text-2xl font-semibold text-ink" id={`${id}-upcoming-heading`}>
                Upcoming Interviews <span className="font-sans text-base font-medium text-ink-soft">({query ? upcoming.length : upcomingCount})</span>
              </h2>
              {upcoming.length > 0 && (
                <button
                  className="rounded-nook-sm bg-paper px-3 py-2 text-sm font-semibold text-ink-soft shadow-nook motion-interactive hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
                  onClick={() => downloadCalendar(`nook-upcoming-interviews-${today}.ics`, [...upcoming].sort(compareInterviews).map(toCalendar))}
                  type="button"
                >
                  Export {query ? "shown" : "all"} to calendar (.ics)
                </button>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="py-8 text-sm text-ink-soft">{query ? "No interviews match your search." : "All caught up — no interviews on the horizon."}</p>
            ) : (
              <div className="flex flex-col gap-9 sm:gap-12">
                {groups.map((group) => (
                  <section key={group.key} aria-labelledby={`${id}-${group.key}-heading`}>
                    <h3 className={`mb-5 border-b border-line/70 pb-3 font-sans text-xs font-semibold uppercase tracking-[0.12em] ${group.key === "today" ? "text-forest" : group.key === "tomorrow" ? "text-gold" : group.key === "later-this-week" ? "text-clay" : "text-rose"}`} id={`${id}-${group.key}-heading`}>
                      {group.label}
                    </h3>
                    <div>
                      {group.interviews.map((interview) => <InterviewRow key={interview.id} interview={interview} onOpen={onOpen} />)}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section aria-labelledby={`${id}-past-heading`}>
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-serif text-2xl font-semibold text-ink" id={`${id}-past-heading`}>Past Interviews</h2>
              <button
                aria-label={`Sort past interviews: ${pastSort === "recent" ? "most recent first" : "oldest first"}`}
                className="rounded-nook-sm bg-paper px-3 py-2 text-sm font-semibold text-ink-soft shadow-nook motion-interactive hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
                onClick={() => setPastSort((current) => current === "recent" ? "oldest" : "recent")}
                type="button"
              >
                {pastSort === "recent" ? "Most recent first" : "Oldest first"} <span aria-hidden="true">↕</span>
              </button>
            </div>
            {past.length === 0 ? (
              <p className="py-8 text-sm text-ink-soft">{query ? "No interviews match your search." : "None yet — patience, and a callback, will fix that."}</p>
            ) : (
              <div>{past.map((interview) => <InterviewRow key={interview.id} interview={interview} onOpen={onOpen} />)}</div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
