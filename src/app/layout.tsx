import "@fontsource-variable/manrope";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "OCCASIO · Your next opening", template: "%s · OCCASIO" },
  description: "Share opportunities you find, unlock ones that fit you, and get your application in before the deadline.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { themeColor: "#151812", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
