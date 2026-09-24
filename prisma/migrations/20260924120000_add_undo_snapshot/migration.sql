CREATE TABLE "UndoSnapshot" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "UndoSnapshot_expiresAt_idx" ON "UndoSnapshot"("expiresAt");
