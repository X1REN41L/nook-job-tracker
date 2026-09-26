# Nook

Nook is a local job and internship application tracker. It provides a focused
Kanban workspace for recording applications, moving them through the hiring
process, and backing up or restoring application data.

## Features

- Track company, role, status, applied date, source, job link, and notes
- Manage applications in an editable Kanban board
- Use five statuses: Applied, Online assessment, Interview, Offer, and Rejected
- Drag applications with pointer, touch, or keyboard controls
- Archive applications separately from their application status, and restore
  them to the active board
- Search by company or role and filter active board statuses
- Create, edit, and delete applications with client- and server-side validation
- Detect likely duplicate company-and-role entries before saving
- Undo a deletion, status change, or archive action from the confirmation toast
- Back up and restore applications with JSON import and export
- Switch between light and dark themes, including system-theme support
- Use keyboard shortcuts for common actions, search, archiving, deletion, and
  undo
- Persist sidebar and archive panel preferences in the browser

## Architecture

Nook is a Next.js application using React and TypeScript. The page is rendered
from the local SQLite database, while the interactive dashboard runs on the
client. Application changes use the built-in `/api/applications` routes and are
validated with Zod.

```text
src/
  app/
    page.tsx                  Loads applications for the dashboard
    api/applications/         Application CRUD and status-update routes
  components/
    application-dashboard.tsx Client workspace, dialogs, settings, and export
    kanban-board.tsx          Board columns and draggable application cards
    job-modal.tsx             Application form
  lib/                        Validation, status metadata, dates, and API helpers
prisma/
  schema.prisma               SQLite application and event models
  migrations/                 Database migrations
```

Application records are stored in SQLite through Prisma. Status changes create
an associated event record. The UI uses dnd-kit for drag-and-drop,
next-themes for appearance preferences, and Tailwind CSS for styling.

## Backup & Restore

Open Settings, then Backup & Restore. Select **Export JSON** to download a
version 1 backup of all stored applications, IDs, timestamps, event history,
prompt state, and browser settings. Select **Import JSON** to merge a current version 1
backup. Import creates missing IDs, skips identical IDs, and rejects changed
records with the same ID (HTTP 409) without making partial changes. Existing
applications are never deleted. Similar applications with different IDs require
confirmation. An empty application list can restore settings alone. Outdated
development backups and array backups are unsupported. Settings are stored in this
browser; if browser storage fails, the import reports the application result
separately.

## Run locally

Requires Node.js 20.9 or newer and npm.

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Development and production
servers bind to this loopback address. Remote access requires a separate
authentication and trusted proxy design; forwarded headers are not used for
rate limiting.

The default environment configuration uses a local SQLite database:

```dotenv
DATABASE_URL="file:./dev.db"
```

## Commands

```bash
npm run dev              # Start the development server
npm run build            # Create a production build
npm run start            # Run the production build
npm run lint             # Run ESLint
npm run typecheck        # Check TypeScript
npm run test:keyboard    # Run keyboard interaction tests
npm run test:duplicates  # Run duplicate-matching tests
npm run test:smoke       # Run application API smoke tests
npm run test:backup      # Run backup and restore API tests
npm run db:studio        # Open Prisma Studio
```

## License

Licensed under the [MIT License](LICENSE).
