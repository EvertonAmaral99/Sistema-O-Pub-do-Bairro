import type { Metadata } from "next";
import "./globals.css";
import "./help.css";
import "./help-pdf-pending.css";

export const metadata: Metadata = {
  title: "O Pub do Bairro | Gestão",
  description: "Sistema de gestão do O Pub do Bairro.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/logo-pub-do-bairro.png",
    shortcut: "/logo-pub-do-bairro.png",
    apple: "/logo-pub-do-bairro.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
