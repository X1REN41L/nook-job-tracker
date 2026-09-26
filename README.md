# Nook

Nook is a local-first job application tracker for organizing opportunities, following your progress, and keeping your application data on your computer.

## Features

- **Overview dashboard:** See your application pipeline, upcoming interviews, and applications that need attention.
- **Job Board:** Move applications through a Kanban workflow, with drag-and-drop and keyboard controls.
- **Application management:** Add, edit, search, filter, and delete applications. Keep company, role, dates, source, notes, and posting links together; open saved links from board cards.
- **Duplicate-entry warnings:** Review possible matches before saving a similar application.
- **Interviews:** Record interview dates and browse upcoming and past interviews.
- **Analytics:** Review application activity and outcomes over selected time periods.
- **Stale application tracking:** Find applications that have gone without a status update, with a configurable threshold.
- **Archive and restore:** Move applications out of the active board and bring them back when needed.
- **Undo:** Reverse recent status changes, archive actions, and deletions.
- **Keyboard shortcuts:** Use shortcuts for common actions, search, navigation, and undo.
- **Customizable boards:** Change board names, colors, order, and empty-state messages.
- **Themes and motion:** Choose light, dark, or system theme and adjust motion preferences.
- **JSON Backup & Restore:** Export your data and import a Nook backup from Settings.

## Architecture / Tech Stack

Nook uses Next.js, React, TypeScript, and Tailwind CSS. Prisma stores application data in a local SQLite database. The app is local-first; normal use requires no external database or cloud service.

## Local Data & Privacy

Nook runs locally and stores application data in a SQLite database on your computer. No account or authentication is required. Normal use does not send your job or application data to an external service. Use Backup & Restore to preserve your data or move it to another installation.

## Setup

Install Node.js and npm, then run:

```bash
git clone https://github.com/X1REN41L/nook-job-tracker.git
cd nook-job-tracker
npm install
npm run setup
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) after the development server starts.

`npm run setup` creates local configuration when needed, initializes or syncs the SQLite database, and prepares Prisma for local use. It keeps existing local configuration and data when they do not need to change.

## Running Nook

After setup, start Nook again with:

```bash
npm run dev
```

## Common Commands

```bash
npm run setup      # Create local configuration and sync the database
npm run dev        # Start the development server
npm run build      # Create a production build
npm run start      # Run the production build
npm run lint       # Run ESLint
npm run typecheck  # Check TypeScript
npm run db:studio  # Open Prisma Studio
```

Additional development scripts are listed in `package.json`.

## Backup & Restore

In Settings, use Backup & Restore to export a JSON backup or import one. Backups are the recommended way to preserve or transfer your application data.

## License

Licensed under the [MIT License](LICENSE).
