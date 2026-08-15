import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "O Pub do Bairro | Gestão",
  description: "Sistema de gestão do O Pub do Bairro.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
