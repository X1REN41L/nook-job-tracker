"use client";

import { useEffect } from "react";

/** Shown when a page fails to render, for example when the database cannot be read. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6 text-ink">
      <div className="max-w-md rounded-nook border border-line bg-paper p-6 shadow-nook-lift" role="alert">
        <h1 className="font-serif text-xl font-semibold">This page could not be loaded</h1>
        <p className="mt-2 text-sm text-ink-soft">Nook could not read your applications. Your data has not been changed.</p>
        <button className="btn-primary mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" onClick={() => retry()} type="button">Try again</button>
      </div>
    </main>
  );
}
