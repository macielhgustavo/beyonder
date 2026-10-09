import { ControlAuthentication } from "../components/control-authentication";
import { getOrCreateAuthToken } from "../control/auth-token";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./premium.css";
import "./premium-secondary.css";
import "./premium-polish.css";

export const metadata: Metadata = {
  title: "Beyonder Control Center",
  description: "Local-first human control center for the Beyonder runtime."
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await getOrCreateAuthToken();
  return (
    <html lang="pt-BR">
      <body><ControlAuthentication />{children}</body>
    </html>
  );
}
