import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Public_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Streetprice",
  description: "A local energy price for low-voltage feeders around Oxford.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
