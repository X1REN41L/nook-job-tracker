"use client";

import { useEffect } from "react";

/** Replaces the root layout when it fails to render, so it brings its own document and minimal styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <title>Nook</title>
        <div role="alert" style={{ maxWidth: "28rem", padding: "1.5rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Nook could not be loaded</h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75 }}>Nook could not read its data. Your data has not been changed.</p>
          <button onClick={() => retry()} style={{ marginTop: "0.75rem", padding: "0.5rem 1rem", font: "inherit", cursor: "pointer" }} type="button">Try again</button>
        </div>
      </body>
    </html>
  );
}
