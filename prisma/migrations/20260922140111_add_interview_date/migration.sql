-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "source" TEXT,
    "appliedDate" DATETIME NOT NULL,
    "interviewDate" DATETIME,
    "interviewDatePromptDismissed" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" DATETIME NOT NULL,
    "notes" TEXT,
    "jobUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Application" ("appliedDate", "company", "createdAt", "id", "jobUrl", "lastUpdated", "notes", "role", "source", "status") SELECT "appliedDate", "company", "createdAt", "id", "jobUrl", "lastUpdated", "notes", "role", "source", "status" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_status_idx" ON "Application"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
