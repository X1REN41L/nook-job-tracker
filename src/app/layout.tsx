import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

import { ThemeProvider } from "@/components/theme-provider";
import { MotionPreference } from "@/components/motion-preference";
import { readSettings } from "@/lib/database-settings";
import { applyTheme } from "@/lib/apply-theme";
import nookIcon from "./nook-icon.png";

import "./globals.css";

const fraunces = localFont({
  src: "./fonts/Fraunces.ttf",
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
});

const karla = localFont({
  src: "./fonts/Karla.ttf",
  weight: "200 800",
  variable: "--font-karla",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nook",
  description: "Track job and internship applications in one place.",
  icons: { icon: { url: nookIcon.src, type: "image/png" } },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const initialState = await readSettings();
  const themeScript = `(${applyTheme.toString()})(${JSON.stringify(initialState.settings.theme)}, matchMedia("(prefers-color-scheme: dark)").matches);`;
  return (
    <html lang="en" className={`${fraunces.variable} ${karla.variable}`} data-motion={initialState.settings.motion} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <ThemeProvider initialState={initialState}>
          <MotionPreference />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
