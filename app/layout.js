import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: "CFB Pick'em Matrix",
  description: "Live sportsbook-style pick'em matrix for college football",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#0b1120", color: "#f8fafc", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
