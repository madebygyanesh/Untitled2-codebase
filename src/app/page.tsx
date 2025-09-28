import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="container mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="grid gap-6 md:grid-cols-2 md:gap-8 items-center">
          <div className="space-y-6">
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight">Digital Signage System</h1>
            <p className="text-muted-foreground max-w-prose">
              Manage content, schedule playback, and display synchronized full-screen signage across devices. Optimized for Vercel deployment with local server storage.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/admin">Go to Admin</Link>
              </Button>
              <Button variant="secondary" asChild className="w-full sm:w-auto">
                <Link href="/player">Open Player</Link>
              </Button>
            </div>
          </div>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>1. Login to the Admin portal and upload images/videos.</p>
              <p>2. Create a schedule for your content with start/end time and order.</p>
              <p>3. Open the Player on any device and it will sync in real-time.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="px-4 sm:px-6 pb-12 sm:pb-16">
        <div className="container mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          <Card>
            <CardHeader><CardTitle>Local storage</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Uses public/uploads in dev and /tmp on Vercel with streaming.</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Real-time sync</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Lightweight WebSocket channel broadcasts updates to all players.</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Error handling</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Server-side validation and safe fallbacks for robust operation.</CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}