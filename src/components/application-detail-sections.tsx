"use client";

import type { EventType, InterviewType, Status } from "@prisma/client";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { formatCalendarDate, formatTimestamp } from "@/lib/application-date";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import { downloadCalendar } from "@/lib/ics";
import { compareInterviews, formatInterviewTime, INTERVIEW_TYPE_LABELS, INTERVIEW_TYPES } from "@/lib/interviews";
import type { ApplicationRecord, ContactRecord, InterviewRecord } from "@/types/application";

export type ApplicationChange =
  | { kind: "follow-up"; followUpDate: string | null }
  | { kind: "item"; collection: "interviews" | "contacts" | "notes" | "status-events"; method: "POST" | "PUT" | "DELETE"; itemId?: string; fields?: Record<string, unknown> };
export type SaveChange = (change: ApplicationChange) => Promise<string | null>;
export type HistoryEvent = { id: string; type: EventType; fromStatus: Status | null; toStatus: Status | null; detail: string | null; createdAt: string };

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";
const smallButton = `rounded-nook-sm px-2 py-1 text-xs font-medium motion-interactive disabled:opacity-60 ${focusRing}`;
const linkButton = `${smallButton} text-forest hover:bg-forest-tint`;
const fieldLabel = "block text-xs font-semibold text-ink-soft";

/** Runs one save at a time and keeps its error message for display. */
function useSave(save: SaveChange) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function run(change: ApplicationChange) {
    setSaving(true);
    setError("");
    const message = await save(change);
    setSaving(false);
    setError(message ?? "");
    return message === null;
  }
  return { saving, error, run, clearError: () => setError("") };
}

function SectionHeading({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-serif text-base font-semibold" id={id}>{title}</h3>
      {action}
    </div>
  );
}

function ErrorText({ message }: { message: string }) {
  return message ? <p className="mt-2 text-sm text-rose" role="alert">{message}</p> : null;
}

/** A Delete button that asks for a second click before it removes anything. */
function DeleteButton({ label, disabled, onDelete }: { label: string; disabled: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button aria-label={`Delete ${label}`} className={`${smallButton} text-rose hover:bg-rose-tint`} disabled={disabled} onClick={() => setConfirming(true)} type="button">Delete</button>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button className={`${smallButton} bg-rose text-paper`} disabled={disabled} onClick={() => { setConfirming(false); onDelete(); }} type="button">Confirm delete</button>
      <button className={`${smallButton} text-ink-soft hover:bg-cream-2`} onClick={() => setConfirming(false)} type="button">Keep</button>
    </span>
  );
}

function FormActions({ saving, submitLabel, onCancel }: { saving: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button className={`btn-ghost px-3 py-1.5 text-sm ${focusRing}`} disabled={saving} onClick={onCancel} type="button">Cancel</button>
      <button className={`btn-primary px-3 py-1.5 text-sm ${focusRing}`} disabled={saving} type="submit">{saving ? "Saving…" : submitLabel}</button>
    </div>
  );
}

export function FollowUpSection({ application, today, onSave }: { application: ApplicationRecord; today: string; onSave: SaveChange }) {
  const { saving, error, run } = useSave(onSave);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const date = application.followUpDate?.slice(0, 10) ?? null;
  const due = Boolean(date && today && date <= today);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run({ kind: "follow-up", followUpDate: draft || null })) setEditing(false);
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="mt-7">
      <SectionHeading id={`${inputId}-heading`} title="Follow-up" />
      {editing ? (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className={fieldLabel} htmlFor={inputId}>
            Follow up on
            <input className="input mt-1.5 w-44 text-sm" id={inputId} onChange={(event) => setDraft(event.target.value)} required type="date" value={draft} />
          </label>
          <FormActions onCancel={() => setEditing(false)} saving={saving} submitLabel="Save" />
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {date ? (
            <span className={due ? "font-medium text-clay" : ""}>{due ? "Due" : "Follow up on"} {formatCalendarDate(date)}</span>
          ) : <span className="text-ink-soft">No reminder set.</span>}
          <button className={linkButton} disabled={saving} onClick={() => { setDraft(date ?? today); setEditing(true); }} type="button">{date ? "Change" : "Set reminder"}</button>
          {date && <button className={linkButton} disabled={saving} onClick={() => void run({ kind: "follow-up", followUpDate: null })} type="button">Mark done</button>}
        </div>
      )}
      <ErrorText message={error} />
    </section>
  );
}

type InterviewFields = { date: string; time: string; type: InterviewType; interviewers: string; notes: string };

function InterviewForm({ initial, saving, submitLabel, onCancel, onSubmit }: {
  initial: InterviewFields;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (fields: InterviewFields) => void;
}) {
  const [fields, setFields] = useState(initial);
  const id = useId();
  const set = <K extends keyof InterviewFields>(key: K, value: InterviewFields[K]) => setFields((current) => ({ ...current, [key]: value }));
  return (
    <form className="mt-3 grid gap-3 rounded-nook-sm border border-line bg-cream p-3" onSubmit={(event) => { event.preventDefault(); onSubmit(fields); }}>
      <div className="grid grid-cols-3 gap-2">
        <label className={fieldLabel} htmlFor={`${id}-date`}>Date<input className="input mt-1.5 text-sm" id={`${id}-date`} onChange={(event) => set("date", event.target.value)} required type="date" value={fields.date} /></label>
        <label className={fieldLabel} htmlFor={`${id}-time`}>Time <span className="font-normal">(optional)</span><input className="input mt-1.5 text-sm" id={`${id}-time`} onChange={(event) => set("time", event.target.value)} type="time" value={fields.time} /></label>
        <label className={fieldLabel} htmlFor={`${id}-type`}>Type
          <select className="input mt-1.5 text-sm" id={`${id}-type`} onChange={(event) => set("type", event.target.value as InterviewType)} value={fields.type}>
            {INTERVIEW_TYPES.map((type) => <option key={type} value={type}>{INTERVIEW_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
      </div>
      <label className={fieldLabel} htmlFor={`${id}-people`}>Who you met <span className="font-normal">(optional)</span><input className="input mt-1.5 text-sm" id={`${id}-people`} maxLength={200} onChange={(event) => set("interviewers", event.target.value)} placeholder="Names and roles" value={fields.interviewers} /></label>
      <label className={fieldLabel} htmlFor={`${id}-notes`}>Notes <span className="font-normal">(optional)</span><textarea className="scrollbar-styled input mt-1.5 min-h-16 resize-y text-sm" id={`${id}-notes`} maxLength={2_000} onChange={(event) => set("notes", event.target.value)} value={fields.notes} /></label>
      <FormActions onCancel={onCancel} saving={saving} submitLabel={submitLabel} />
    </form>
  );
}

const interviewFields = (interview: InterviewRecord): InterviewFields => ({
  date: interview.date.slice(0, 10), time: interview.time ?? "", type: interview.type, interviewers: interview.interviewers ?? "", notes: interview.notes ?? "",
});

export function InterviewsSection({ application, today, onSave }: { application: ApplicationRecord; today: string; onSave: SaveChange }) {
  const { saving, error, run } = useSave(onSave);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const headingId = useId();
  const rounds = [...application.interviews].sort(compareInterviews);

  async function save(fields: InterviewFields, itemId?: string) {
    const saved = await run({ kind: "item", collection: "interviews", method: itemId ? "PUT" : "POST", itemId, fields: { ...fields } });
    if (saved) setEditing(null);
  }

  return (
    <section aria-labelledby={headingId} className="mt-7">
      <SectionHeading
        action={editing !== "new" && <button className={linkButton} disabled={saving} onClick={() => setEditing("new")} type="button">Add round</button>}
        id={headingId}
        title="Interviews"
      />
      {editing === "new" && (
        <InterviewForm initial={{ date: today, time: "", type: "OTHER", interviewers: "", notes: "" }} onCancel={() => setEditing(null)} onSubmit={(fields) => void save(fields)} saving={saving} submitLabel="Add round" />
      )}
      {rounds.length === 0 && editing !== "new" && <p className="mt-2 text-sm text-ink-soft">No interview rounds yet.</p>}
      <ul className="mt-2 divide-y divide-line/70">
        {rounds.map((interview) => (
          <li className="py-2.5" key={interview.id}>
            {editing === interview.id ? (
              <InterviewForm initial={interviewFields(interview)} onCancel={() => setEditing(null)} onSubmit={(fields) => void save(fields, interview.id)} saving={saving} submitLabel="Save round" />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {formatCalendarDate(interview.date)}{interview.time && `, ${formatInterviewTime(interview.time)}`}
                    <span className="font-normal text-ink-soft"> · {INTERVIEW_TYPE_LABELS[interview.type]}</span>
                    {today && interview.date.slice(0, 10) < today && <span className="font-normal text-ink-soft"> · Past</span>}
                  </p>
                  {interview.interviewers && <p className="mt-0.5 break-words text-ink-soft">With {interview.interviewers}</p>}
                  {interview.notes && <p className="mt-1 whitespace-pre-wrap break-words">{interview.notes}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                  <button
                    aria-label={`Add the ${formatCalendarDate(interview.date)} interview to your calendar`}
                    className={linkButton}
                    onClick={() => downloadCalendar(`interview-${interview.date.slice(0, 10)}.ics`, [{ ...interview, role: application.role, company: application.company }])}
                    title="Download an .ics calendar file"
                    type="button"
                  >
                    .ics
                  </button>
                  <button className={linkButton} disabled={saving || editing !== null} onClick={() => setEditing(interview.id)} type="button">Edit</button>
                  <DeleteButton disabled={saving} label={`the ${formatCalendarDate(interview.date)} interview`} onDelete={() => void run({ kind: "item", collection: "interviews", method: "DELETE", itemId: interview.id })} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </section>
  );
}

type ContactFields = { name: string; role: string; email: string; linkedinUrl: string; notes: string };

function ContactForm({ initial, saving, submitLabel, onCancel, onSubmit }: {
  initial: ContactFields;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (fields: ContactFields) => void;
}) {
  const [fields, setFields] = useState(initial);
  const id = useId();
  const set = (key: keyof ContactFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  return (
    <form className="mt-3 grid gap-3 rounded-nook-sm border border-line bg-cream p-3" onSubmit={(event) => { event.preventDefault(); onSubmit(fields); }}>
      <div className="grid grid-cols-2 gap-2">
        <label className={fieldLabel} htmlFor={`${id}-name`}>Name<input className="input mt-1.5 text-sm" id={`${id}-name`} maxLength={120} onChange={(event) => set("name", event.target.value)} required value={fields.name} /></label>
        <label className={fieldLabel} htmlFor={`${id}-role`}>Role <span className="font-normal">(optional)</span><input className="input mt-1.5 text-sm" id={`${id}-role`} maxLength={120} onChange={(event) => set("role", event.target.value)} placeholder="Recruiter, referrer…" value={fields.role} /></label>
      </div>
      <label className={fieldLabel} htmlFor={`${id}-email`}>Email <span className="font-normal">(optional)</span><input className="input mt-1.5 text-sm" id={`${id}-email`} maxLength={254} onChange={(event) => set("email", event.target.value)} type="email" value={fields.email} /></label>
      <label className={fieldLabel} htmlFor={`${id}-linkedin`}>LinkedIn <span className="font-normal">(optional)</span><input className="input mt-1.5 text-sm" id={`${id}-linkedin`} maxLength={2_000} onChange={(event) => set("linkedinUrl", event.target.value)} placeholder="https://www.linkedin.com/in/…" type="url" value={fields.linkedinUrl} /></label>
      <label className={fieldLabel} htmlFor={`${id}-notes`}>Notes <span className="font-normal">(optional)</span><textarea className="scrollbar-styled input mt-1.5 min-h-16 resize-y text-sm" id={`${id}-notes`} maxLength={2_000} onChange={(event) => set("notes", event.target.value)} value={fields.notes} /></label>
      <FormActions onCancel={onCancel} saving={saving} submitLabel={submitLabel} />
    </form>
  );
}

function safeLink(value: string | null) {
  try {
    if (value && ["http:", "https:"].includes(new URL(value).protocol)) return value;
  } catch {
    // Stored links are validated; anything else is simply not linked.
  }
  return undefined;
}

const contactFields = (contact: ContactRecord): ContactFields => ({
  name: contact.name, role: contact.role ?? "", email: contact.email ?? "", linkedinUrl: contact.linkedinUrl ?? "", notes: contact.notes ?? "",
});

export function ContactsSection({ application, onSave }: { application: ApplicationRecord; onSave: SaveChange }) {
  const { saving, error, run } = useSave(onSave);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const headingId = useId();

  async function save(fields: ContactFields, itemId?: string) {
    const saved = await run({ kind: "item", collection: "contacts", method: itemId ? "PUT" : "POST", itemId, fields: { ...fields } });
    if (saved) setEditing(null);
  }

  return (
    <section aria-labelledby={headingId} className="mt-7">
      <SectionHeading
        action={editing !== "new" && <button className={linkButton} disabled={saving} onClick={() => setEditing("new")} type="button">Add contact</button>}
        id={headingId}
        title="Contacts"
      />
      {editing === "new" && (
        <ContactForm initial={{ name: "", role: "", email: "", linkedinUrl: "", notes: "" }} onCancel={() => setEditing(null)} onSubmit={(fields) => void save(fields)} saving={saving} submitLabel="Add contact" />
      )}
      {application.contacts.length === 0 && editing !== "new" && <p className="mt-2 text-sm text-ink-soft">No contacts yet.</p>}
      <ul className="mt-2 divide-y divide-line/70">
        {application.contacts.map((contact) => {
          const linkedin = safeLink(contact.linkedinUrl);
          return (
            <li className="py-2.5" key={contact.id}>
              {editing === contact.id ? (
                <ContactForm initial={contactFields(contact)} onCancel={() => setEditing(null)} onSubmit={(fields) => void save(fields, contact.id)} saving={saving} submitLabel="Save contact" />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="break-words font-medium">{contact.name}{contact.role && <span className="font-normal text-ink-soft"> · {contact.role}</span>}</p>
                    {(contact.email || linkedin) && (
                      <p className="mt-0.5 flex flex-wrap gap-x-3">
                        {contact.email && <a className={`break-all text-forest hover:underline ${focusRing}`} href={`mailto:${contact.email}`}>{contact.email}</a>}
                        {linkedin && <a className={`text-forest hover:underline ${focusRing}`} href={linkedin} rel="noopener noreferrer" target="_blank">LinkedIn</a>}
                      </p>
                    )}
                    {contact.notes && <p className="mt-1 whitespace-pre-wrap break-words text-ink-soft">{contact.notes}</p>}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button className={linkButton} disabled={saving || editing !== null} onClick={() => setEditing(contact.id)} type="button">Edit</button>
                    <DeleteButton disabled={saving} label={contact.name} onDelete={() => void run({ kind: "item", collection: "contacts", method: "DELETE", itemId: contact.id })} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText message={error} />
    </section>
  );
}

function statusEventLabel(event: HistoryEvent, boards: BoardConfiguration[]) {
  if (!event.toStatus) return event.detail?.trim() || "Status changed";
  if (!event.fromStatus) return `Added as ${boardLabel(boards, event.toStatus)}`;
  return `Moved from ${boardLabel(boards, event.fromStatus)} to ${boardLabel(boards, event.toStatus)}`;
}

/**
 * Status changes and dated notes, newest first. Notes can be added, edited (keeping their date), and deleted;
 * status changes can be deleted, and removing the latest one moves the application back to its previous status.
 */
export function TimelineSection({ boards, events, loadError, onSave }: {
  boards: BoardConfiguration[];
  events: HistoryEvent[] | null;
  loadError: boolean;
  onSave: SaveChange;
}) {
  const { saving, error, run } = useSave(onSave);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const headingId = useId();

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run({ kind: "item", collection: "notes", method: "POST", fields: { text: draft } })) setDraft("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing && await run({ kind: "item", collection: "notes", method: "PUT", itemId: editing.id, fields: { text: editing.text } })) setEditing(null);
  }

  return (
    <section aria-labelledby={headingId} className="mt-7">
      <SectionHeading id={headingId} title="Timeline" />
      <form className="mt-2" onSubmit={addNote}>
        <label className="sr-only" htmlFor={`${headingId}-note`}>New note</label>
        <textarea className="scrollbar-styled input min-h-16 resize-y text-sm" id={`${headingId}-note`} maxLength={5_000} onChange={(event) => setDraft(event.target.value)} placeholder="Add a dated note: a call, an email, a next step…" value={draft} />
        <div className="mt-2 flex justify-end">
          <button className={`btn-primary px-3 py-1.5 text-sm ${focusRing}`} disabled={saving || !draft.trim()} type="submit">{saving && !editing ? "Saving…" : "Add note"}</button>
        </div>
      </form>
      <ErrorText message={error} />
      {loadError ? (
        <p className="mt-3 text-sm text-ink-soft">The timeline could not be loaded.</p>
      ) : !events ? (
        <p className="mt-3 text-sm text-ink-soft" role="status">Loading timeline…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">No status changes or notes recorded.</p>
      ) : (
        <ol className="mt-4 border-l border-line pl-4">
          {[...events].reverse().map((event) => (
            <li className="relative pb-4 last:pb-0" key={event.id}>
              <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper ${event.type === "NOTE_ADDED" ? "bg-ink-soft" : event.toStatus ? boardDot(boards, event.toStatus) : "bg-neutral-dim"}`} />
              {event.type === "NOTE_ADDED" ? (
                editing?.id === event.id ? (
                  <form onSubmit={saveEdit}>
                    <label className="sr-only" htmlFor={`${event.id}-edit`}>Edit note</label>
                    <textarea className="scrollbar-styled input min-h-16 resize-y text-sm" id={`${event.id}-edit`} maxLength={5_000} onChange={(change) => setEditing({ id: event.id, text: change.target.value })} value={editing.text} />
                    <div className="mt-2"><FormActions onCancel={() => setEditing(null)} saving={saving} submitLabel="Save note" /></div>
                  </form>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm">{event.detail}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                      <span>Note · <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time></span>
                      <button className={linkButton} disabled={saving || editing !== null} onClick={() => setEditing({ id: event.id, text: event.detail ?? "" })} type="button">Edit</button>
                      <DeleteButton disabled={saving} label="this note" onDelete={() => void run({ kind: "item", collection: "notes", method: "DELETE", itemId: event.id })} />
                    </p>
                  </>
                )
              ) : (
                <>
                  <p className="text-sm font-medium">{statusEventLabel(event, boards)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                    <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time>
                    <DeleteButton disabled={saving || editing !== null} label="this status change" onDelete={() => void run({ kind: "item", collection: "status-events", method: "DELETE", itemId: event.id })} />
                  </p>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
