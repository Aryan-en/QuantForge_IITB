import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FORGE",
  description: "Think. Understand. Engineer. Verify.",
};

// No next/font here: the shared UI uses the VS Code / system font stack so it matches the webview (ADR-009).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
