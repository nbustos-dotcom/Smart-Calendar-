// ============================================================================
// ROOT LAYOUT — the HTML shell wrapped around EVERY page
//
// Sets up the fonts and the <html>/<body> tags. Every page in src/app renders
// inside this. You rarely edit it except to change something site-wide.
// ============================================================================
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Smart Calendar",
  description:
    "A deterministic study calendar that reads your Canvas deadlines (read-only).",
};

// Runs before the page paints: applies the saved theme (or the OS preference if
// none saved) by toggling the `dark` / `hyper-focus` class on <html>, so there's no flash of the
// wrong theme. Theme is stored per-browser in localStorage — no backend.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var dark=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);var el=document.documentElement;el.classList.remove('dark','hyper-focus');if(t==='dark')el.classList.add('dark');if(t==='hyper-focus')el.classList.add('hyper-focus');}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The theme script mutates the class list before React hydrates, so tell
      // React not to warn about the resulting mismatch on <html>.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
