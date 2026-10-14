import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Streetprice · Oxford",
  description: "Oxford LV feeder loading, peak-day comparison and simulated home-battery response.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
