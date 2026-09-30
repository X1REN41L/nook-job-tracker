// Adds sample applications that exercise every feature to the running app, keeping its current settings.
// Dates are relative to today on this machine, in its time zone. Each run adds another copy; to start over,
// use Delete all data in Settings first.
//
//   node scripts/sample-data.mjs            import into http://127.0.0.1:3000
//   node scripts/sample-data.mjs --dry-run  print the backup JSON instead
//   NOOK_URL=http://127.0.0.1:3001 node scripts/sample-data.mjs
import { randomUUID } from "node:crypto";

const base = process.env.NOOK_URL ?? "http://127.0.0.1:3000";
const pad = (value) => String(value).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const offsetMinutes = -now.getTimezoneOffset();
const offset = `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;

const dayKey = (days) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const calendar = (days) => `${dayKey(days)}T00:00:00.000Z`;
const at = (days, hour = 10, minute = 0) => new Date(`${dayKey(days)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`).toISOString();

/**
 * steps: [[daysAgo, status], ...] oldest first; the first entry is the initial status on the applied date.
 * notes: [[daysAgo, text]]; interviews: [{ in, time, type, interviewers, notes }]; contacts: [{...}]
 */
function application({ company, role, source = null, jobUrl = null, summary = null, archived = false, steps, notes = [], interviews = [], contacts = [], followUp = null, followUpNote = null, promptDismissed = true, firstHour = 9 }) {
  const events = [];
  steps.forEach(([daysAgo, status], index) => {
    const fromStatus = index === 0 ? null : steps[index - 1][1];
    events.push({ id: randomUUID(), type: "STATUS_CHANGE", detail: `${fromStatus ?? "null"} → ${status}`, fromStatus, toStatus: status, createdAt: at(-daysAgo, daysAgo === 0 ? 0 : firstHour + index, daysAgo === 0 ? 5 : 15) });
  });
  for (const [daysAgo, text] of notes) {
    events.push({ id: randomUUID(), type: "NOTE_ADDED", detail: text, fromStatus: null, toStatus: null, createdAt: at(-daysAgo, 16, 40) });
  }
  const times = events.map((event) => event.createdAt).sort();
  return {
    id: randomUUID(), company, role, status: steps.at(-1)[1], archived, source, appliedDate: calendar(-steps[0][0]),
    interviewDatePromptDismissed: promptDismissed, followUpDate: followUp === null ? null : calendar(followUp), followUpNote: followUp === null ? null : followUpNote,
    notes: summary, jobUrl, createdAt: times[0], lastUpdated: times.at(-1), events,
    interviews: interviews.map((round) => ({
      id: randomUUID(), date: calendar(round.in), time: round.time ?? null, type: round.type,
      interviewers: round.interviewers ?? null, notes: round.notes ?? null, createdAt: times.at(-1),
    })),
    contacts: contacts.map((contact) => ({
      id: randomUUID(), name: contact.name, role: contact.role ?? null, email: contact.email ?? null,
      linkedinUrl: contact.linkedinUrl ?? null, notes: contact.notes ?? null, createdAt: times[0],
    })),
  };
}

const applications = [
  // Applied — today, yesterday, and earlier this week
  application({ company: "Raycast", role: "Frontend Engineer", source: "Company site", steps: [[0, "APPLIED"]], summary: "Applied just after midnight." }),
  application({ company: "Linear", role: "Product Engineer", source: "Company site", jobUrl: "https://linear.app/careers", steps: [[1, "APPLIED"]], firstHour: 20,
    summary: "Small team, strong design culture. Remote-friendly.", followUp: 6, followUpNote: "Check whether the recruiter replied" }),
  application({ company: "Vercel", role: "Frontend Engineer", source: "LinkedIn", jobUrl: "https://vercel.com/careers", steps: [[2, "APPLIED"]],
    contacts: [{ name: "Priya Shah", role: "Recruiter", email: "priya.shah@example.com", linkedinUrl: "https://www.linkedin.com/in/example-priya" }] }),
  // Applied — stale (MEDIUM, HIGH, CRITICAL)
  application({ company: "Atlassian", role: "Software Engineer II", source: "Indeed", steps: [[20, "APPLIED"]], followUp: -3, followUpNote: "Chase the hiring inbox again",
    notes: [[12, "Sent a polite follow-up email to the hiring inbox."]] }),
  application({ company: "Shopify", role: "Backend Developer", source: "Referral", steps: [[42, "APPLIED"]],
    summary: "Referred by Sam from the Rails meetup.", contacts: [{ name: "Sam Okafor", role: "Staff Engineer (referrer)", notes: "Met at the Rails meetup; happy to answer questions." }] }),
  application({ company: "Dropbox", role: "Full Stack Engineer", source: "LinkedIn", steps: [[75, "APPLIED"]], followUp: -1 }),
  // Online assessment
  application({ company: "Datadog", role: "Software Engineer, Observability", source: "LinkedIn", jobUrl: "https://careers.datadoghq.com",
    steps: [[9, "APPLIED"], [4, "ONLINE_ASSESSMENT"]], notes: [[4, "HackerRank link received — 90 minutes, due in 5 days."]], followUp: 0, followUpNote: "Finish the HackerRank before it expires" }),
  application({ company: "Cloudflare", role: "Systems Engineer", source: "Company site", steps: [[38, "APPLIED"], [33, "ONLINE_ASSESSMENT"]],
    summary: "Assessment done; waiting on results for over a month." }),
  // Interview — upcoming rounds in every Interviews group
  application({ company: "Stripe", role: "Software Engineer", source: "Referral", jobUrl: "https://stripe.com/jobs",
    steps: [[25, "APPLIED"], [18, "ONLINE_ASSESSMENT"], [10, "INTERVIEW"]],
    summary: "Payments infra team. Bring questions about on-call and the API versioning story.",
    notes: [[10, "Recruiter call went well; they're moving me to the onsite loop."], [3, "Prepped system design: idempotency keys and retries."]],
    interviews: [
      { in: -8, time: "15:00", type: "PHONE", interviewers: "Maya (recruiter)", notes: "Intro call, 30 minutes." },
      { in: 0, time: "14:30", type: "TECHNICAL", interviewers: "Daniel Kim, Aisha Rahman", notes: "Pair programming in their editor." },
      { in: 7, time: "10:00", type: "ONSITE", interviewers: "Panel of 4", notes: "Virtual onsite, four back-to-back rounds." },
    ],
    contacts: [{ name: "Maya Lopez", role: "Technical Recruiter", email: "maya.lopez@example.com" }, { name: "Daniel Kim", role: "Engineering Manager", linkedinUrl: "https://www.linkedin.com/in/example-daniel" }] }),
  application({ company: "Figma", role: "Software Engineer, Editor", source: "LinkedIn",
    steps: [[30, "APPLIED"], [16, "INTERVIEW"]], interviews: [{ in: 1, time: "11:00", type: "TECHNICAL", interviewers: "Chen Wei" }], followUp: 2, followUpNote: "Send a thank-you note after the technical round" }),
  application({ company: "Notion", role: "Frontend Engineer", source: "Company site",
    steps: [[21, "APPLIED"], [12, "INTERVIEW"]], interviews: [{ in: 3, type: "OTHER", notes: "Take-home review — time to be confirmed." }] }),
  application({ company: "GitHub", role: "Senior Software Engineer", source: "Referral",
    steps: [[40, "APPLIED"], [28, "ONLINE_ASSESSMENT"], [22, "INTERVIEW"]], interviews: [{ in: 20, time: "09:30", type: "ONSITE" }, { in: -15, time: "16:00", type: "PHONE" }] }),
  // Interview without an upcoming round (prompt not yet dismissed)
  application({ company: "Canva", role: "Full Stack Engineer", source: "Indeed", steps: [[19, "APPLIED"], [6, "INTERVIEW"]], promptDismissed: false,
    notes: [[6, "Recruiter says they'll send times for the first round."]] }),
  // Offers
  application({ company: "Spotify", role: "Backend Engineer", source: "LinkedIn", jobUrl: "https://www.lifeatspotify.com",
    steps: [[70, "APPLIED"], [60, "ONLINE_ASSESSMENT"], [50, "INTERVIEW"], [14, "OFFER"]],
    summary: "Offer: base plus equity, 4 weeks to decide.",
    interviews: [{ in: -45, time: "13:00", type: "PHONE" }, { in: -30, time: "10:00", type: "ONSITE", interviewers: "Team Lead, Director" }],
    notes: [[14, "Offer call — asked for the written breakdown."]], followUp: 4, followUpNote: "Decide on the offer" }),
  application({ company: "Airbnb", role: "Software Engineer", source: "Referral", steps: [[110, "APPLIED"], [95, "INTERVIEW"], [80, "OFFER"]],
    interviews: [{ in: -90, time: "12:00", type: "TECHNICAL" }] }),
  // Rejected, at different stages
  application({ company: "Meta", role: "Production Engineer", source: "LinkedIn", steps: [[55, "APPLIED"], [44, "ONLINE_ASSESSMENT"], [36, "INTERVIEW"], [26, "REJECTED"]],
    interviews: [{ in: -32, time: "17:00", type: "TECHNICAL", notes: "Graph problem; ran out of time on the follow-up." }],
    notes: [[26, "Rejected after the technical round. Asked for feedback."]] }),
  application({ company: "Netflix", role: "Senior UI Engineer", source: "Company site", steps: [[65, "APPLIED"], [58, "REJECTED"]] }),
  application({ company: "Uber", role: "Software Engineer II", source: "Indeed", steps: [[150, "APPLIED"], [140, "ONLINE_ASSESSMENT"], [132, "REJECTED"]] }),
  // A move backwards: Interview → Online assessment (extra assessment requested)
  application({ company: "Discord", role: "Backend Engineer", source: "LinkedIn", steps: [[24, "APPLIED"], [17, "INTERVIEW"], [8, "ONLINE_ASSESSMENT"]],
    notes: [[8, "They asked for an extra coding assessment before the final round."]] }),
  // Same company, two roles (duplicate detection: try adding "Stripe / Software Engineer" again)
  application({ company: "Stripe", role: "Frontend Engineer, Dashboard", source: "Company site", steps: [[5, "APPLIED"]] }),
  // Last year, for Custom year analytics
  application({ company: "Twilio", role: "Software Engineer", source: "LinkedIn", steps: [[300, "APPLIED"], [290, "INTERVIEW"], [280, "REJECTED"]] }),
  application({ company: "Asana", role: "Product Engineer", source: "Referral", steps: [[330, "APPLIED"], [320, "ONLINE_ASSESSMENT"], [305, "OFFER"]] }),
  // Archived
  application({ company: "IBM", role: "Software Developer", source: "Indeed", archived: true, steps: [[90, "APPLIED"]], summary: "Archived — role was put on hold." }),
  application({ company: "Oracle", role: "Cloud Engineer", source: "LinkedIn", archived: true, steps: [[120, "APPLIED"], [112, "INTERVIEW"], [100, "REJECTED"]],
    interviews: [{ in: -105, type: "PHONE" }] }),
  application({ company: "Salesforce", role: "Backend Engineer", source: "Company site", archived: true, steps: [[35, "APPLIED"], [27, "INTERVIEW"]],
    interviews: [{ in: 5, time: "15:30", type: "TECHNICAL", notes: "Archived application with an upcoming round." }] }),
];

let settings;
try {
  ({ settings } = await (await fetch(`${base}/api/settings`)).json());
} catch {
  console.error(`Could not reach Nook at ${base}. Start it with \`npm run dev\`, then run this again.`);
  process.exit(1);
}
const backup = { version: 1, applications, settings };
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify(backup, null, 2));
} else {
  const response = await fetch(`${base}/api/applications/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(base).origin },
    body: JSON.stringify(backup),
  });
  const body = await response.json();
  console.log(response.status, response.ok ? `imported ${body.createdIds.length} applications` : JSON.stringify(body, null, 2));
}
