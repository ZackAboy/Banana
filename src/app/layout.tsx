import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Banana Lens — A little clarity before you buy",
  description:
    "Take a photo. Know what it is. Know what it’s worth. A visual shopping assistant with evidence, offers, and review intelligence.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
