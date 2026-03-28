// Root layout for the app shell, global fonts, and shared page metadata.
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Configure Geist Sans and expose it as a CSS variable.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Configure Geist Mono and expose it as a CSS variable.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Define the default metadata for the application.
export const metadata: Metadata = {
  title: "PaperGraph AI",
  description: "Transform research papers into interactive knowledge graphs",
};

// Render the root HTML structure and apply the global dark theme classes.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
