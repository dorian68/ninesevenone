import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Guadeloupe Entreprises",
    template: "%s | Guadeloupe Entreprises"
  },
  description: "Cartographie territoriale des établissements et entreprises de Guadeloupe à partir de sources publiques et vérifiées.",
  metadataBase: new URL("http://localhost:3000")
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
