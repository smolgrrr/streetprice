import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Streetprice · Oxford",
  description: "A historical model of how local grid conditions could affect electricity prices across Oxford.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
