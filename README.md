# Nook

Nook is a local-only job application tracker for organizing opportunities, following your progress, and keeping your application data on your computer.

## Features

- **Overview dashboard:** See your application pipeline, active upcoming interviews, and applications that need attention.
- **Job Board:** Move applications through a Kanban workflow, with drag-and-drop and keyboard controls.
- **Application management:** Add, edit, search, filter, and delete applications. Keep company, role, dates, source, notes, and posting links together; open saved links from board cards.
- **Duplicate-entry warnings:** Review possible matches before saving a similar application.
- **Interviews:** Record interview dates and browse upcoming and past interviews.
- **Analytics:** Review application activity and outcomes over selected time periods.
- **Stale application tracking:** Find applications that have gone without a status update, with a threshold of 7, 15, or 30 days.
- **Archive and restore:** Move applications out of the active board and bring them back when needed.
- **Undo:** Undo your most recent status change, archive action, or deletion. Only the latest action can be undone; a deleted application can be restored for up to 10 minutes.
- **Keyboard shortcuts:** Use shortcuts for common actions, search, navigation, and undo.
- **Customizable boards:** Change board names, colors, order, and empty-state messages. Custom names and colors appear throughout the app.
- **Themes and motion:** Choose a light, dark, or system theme, and turn animations on, off, or follow your system's reduced-motion setting.
- **JSON Backup & Restore:** Export your data and import a Nook backup from Settings.

## Architecture

Nook is a Next.js app written in TypeScript with React and Tailwind CSS. Prisma stores data in a SQLite database file on your computer. The Next.js server provides both the pages and the API that reads and writes the database.

## Local Data & Privacy

- Nook runs only on your computer. It needs no account, external database, or cloud service, and normal use does not send your job or application data anywhere.
- Your data lives in the SQLite file `prisma/dev.db` (set by `DATABASE_URL` in `.env`).
- The server binds to `127.0.0.1` and accepts requests only for `localhost`, `127.0.0.1`, or `[::1]`. Opening Nook through a LAN IP address or another hostname is not supported.
- The database schema is applied with `prisma db push` (through `npm run setup`). Nook does not use Prisma migrations.
- Use Backup & Restore to preserve your data or move it to another installation.

## Requirements

- Node.js `^22.18.0` or `>=23.6.0` (see `engines` in `package.json`)
- npm

## Setup

```bash
git clone https://github.com/X1REN41L/nook-job-tracker.git
cd nook-job-tracker
npm install
npm run setup
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) after the development server starts.

`npm run setup` creates `.env` from `.env.example` if it does not exist, then runs `prisma db push` to create or sync the SQLite database and generate the Prisma client. It keeps an existing `.env` and existing data.

## Running Nook

Start Nook with:

```bash
npm run dev
```

Nook runs only while this command is running; closing the terminal stops it. Your data stays in the database file.

To run a production build instead:

```bash
npm run build
npm run start
```

## Keyboard & Accessibility

- Press `?` to see every shortcut. Common ones: `/` to search, `U` to undo, `G` then `D`, `J`, or `I` to go to the Dashboard, Job Board, or Interviews, `Alt+N` (`⌥N` on macOS) for a new job, and `Esc` to close a dialog.
- On the Job Board, the arrow keys move focus between cards and columns. On a focused card, `Enter` opens it for editing, and `Space` picks it up so the arrow keys can move it to another status column. Screen readers get instructions and announcements for these moves.
- Board order in Settings can also be changed with the keyboard.
- Dialogs keep focus inside them and return it to where you were when they close.

## Backup & Restore

In Settings, use Backup & Restore to export or import a JSON backup. Backups are the recommended way to preserve or transfer your data.

**Export** saves every application, including archived ones and their status history, together with your settings.

**Import** adds the applications from a Nook backup:

- The file must be a valid Nook backup of 10 MB or less, with no more than 5,000 applications. Invalid files are rejected without changing anything.
- Applications that are new are added. Applications that already exist and are identical to the backup are skipped.
- Import never updates an existing application. If any application in the backup has changed since the backup was made (including an archive and unarchive), the whole import stops, names up to three changed applications, and imports nothing.
- When an import succeeds, your current settings are replaced by the settings in the backup, even if every application was skipped.
- If a backup application looks like one you already have, Nook asks whether to import it anyway or cancel the import.

## Common Commands

```bash
npm run setup      # Create .env if needed and sync the database schema
npm run dev        # Start the development server
npm run build      # Create a production build
npm run start      # Run the production build
npm run lint       # Run ESLint
npm run typecheck  # Check TypeScript
npm run db:studio  # Open Prisma Studio
```

## Tests

```bash
npm test                 # Run every non-browser test suite below
npm run test:unit        # Unit tests
npm run test:smoke       # API smoke tests
npm run test:backup      # Backup, import, and restore API tests
npm run test:dashboard   # Dashboard and analytics API tests
npm run test:contention  # Concurrent-request API tests
npm run test:e2e         # Playwright browser tests
```

The API and browser tests each start their own server on a temporary SQLite database, so they never touch your data. `npm run test:e2e` runs in Google Chrome, which must be installed. Other focused scripts are listed in `package.json`.

## License

Licensed under the [MIT License](LICENSE).
