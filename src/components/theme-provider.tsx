"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * shadcn's dark palette is keyed off a `.dark` class rather than a media
 * query, so something has to put that class on <html>. next-themes (already a
 * dependency — shadcn's sonner component uses it) does that from the user's
 * system preference, which keeps the whole palette in the single token block
 * in globals.css and leaves room for an explicit light/dark toggle later.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
