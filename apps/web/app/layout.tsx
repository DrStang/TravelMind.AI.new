export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>{children}</body>
        </html>
    );
}
