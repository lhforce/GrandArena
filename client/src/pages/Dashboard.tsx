/**
 * Dashboard — Main overview page showing contest stats, scrape status, and quick actions.
 * Uses non-blocking scrape with auto-polling for real-time progress.
 */

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Swords,
  Trophy,
  Database,
  Sparkles,
  RefreshCw,
  Brain,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

export default function Dashboard() {
  const [scraping, setScraping] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stats = trpc.contests.stats.useQuery(undefined, {
    refetchInterval: scraping || identifying ? 3000 : false, // Auto-poll while running
  });
  const jobs = trpc.contests.scrapeJobs.useQuery({ limit: 5 }, {
    refetchInterval: scraping || identifying ? 3000 : false,
  });
  const utils = trpc.useUtils();

  // Watch for job completion via polling
  useEffect(() => {
    if (!scraping && !identifying) return;

    const latestJob = jobs.data?.[0];
    if (!latestJob) return;

    if (latestJob.status === "completed" || latestJob.status === "failed") {
      if (scraping) {
        if (latestJob.status === "completed") {
          toast.success("Scrape Complete!", {
            description: `${latestJob.contestsProcessed ?? 0} contests, ${latestJob.entriesProcessed ?? 0} entries processed.`,
          });
        } else {
          toast.error("Scrape Failed", {
            description: latestJob.errorMessage ?? "Unknown error",
          });
        }
        setScraping(false);
      }
      if (identifying) {
        if (latestJob.status === "completed") {
          toast.success("AI Identification Complete!", {
            description: `${latestJob.aiProcessed ?? 0} entries identified.`,
          });
        } else {
          toast.error("Identification Failed", {
            description: latestJob.errorMessage ?? "Unknown error",
          });
        }
        setIdentifying(false);
      }
    }
  }, [jobs.data, scraping, identifying]);

  const triggerScrape = trpc.contests.triggerScrape.useMutation({
    onSuccess: () => {
      toast.info("Scrape Started", {
        description: "Fetching contests and leaderboards in the background. Stats will update automatically.",
      });
      // Keep scraping state — will be cleared by polling
    },
    onError: (err) => {
      toast.error("Failed to Start Scrape", { description: err.message });
      setScraping(false);
    },
  });

  const triggerIdentification = trpc.contests.triggerIdentification.useMutation({
    onSuccess: () => {
      toast.info("AI Identification Started", {
        description: "Analyzing card thumbnails in the background. Stats will update automatically.",
      });
    },
    onError: (err) => {
      toast.error("Failed to Start Identification", { description: err.message });
      setIdentifying(false);
    },
  });

  const handleScrape = () => {
    setScraping(true);
    triggerScrape.mutate();
  };

  const handleIdentify = () => {
    setIdentifying(true);
    triggerIdentification.mutate({ topN: 10 });
  };

  const s = stats.data;

  // Determine if a job is currently running from the latest job status
  const latestJob = jobs.data?.[0];
  const jobRunning = latestJob?.status === "running";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Contest data collection and winning lineup analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleScrape}
            disabled={scraping || jobRunning}
            className="bg-teal hover:bg-teal/90 text-background"
          >
            {scraping || jobRunning ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {scraping || jobRunning ? "Scraping..." : "Scrape Contests"}
          </Button>
          <Button
            onClick={handleIdentify}
            disabled={identifying || jobRunning}
            variant="outline"
            className="border-gold/30 text-gold hover:bg-gold/10"
          >
            {identifying ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 mr-2" />
            )}
            {identifying ? "Identifying..." : "AI Identify Cards"}
          </Button>
        </div>
      </div>

      {/* Progress Banner */}
      {(scraping || identifying || jobRunning) && (
        <Card className="glass-card border-teal/30 bg-teal/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-teal animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-teal">
                  {scraping || (jobRunning && latestJob?.jobType === "contests")
                    ? "Scraping contests and leaderboards..."
                    : "Running AI identification..."}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stats update automatically every 3 seconds. This may take 1-3 minutes.
                  {s && (
                    <span className="ml-2 text-teal">
                      {s.totalContests} contests · {s.totalLeaderboardEntries.toLocaleString()} entries so far
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      {stats.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-24 mb-2" />
                <div className="h-8 bg-muted rounded w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Database className="w-5 h-5 text-teal" />}
            label="Total Contests"
            value={s.totalContests}
          />
          <StatCard
            icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
            label="Completed"
            value={s.completedContests}
          />
          <StatCard
            icon={<Swords className="w-5 h-5 text-gold" />}
            label="Live"
            value={s.liveContests}
            highlight
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-blue-400" />}
            label="Open"
            value={s.openContests}
          />
          <StatCard
            icon={<AlertCircle className="w-5 h-5 text-muted-foreground" />}
            label="Draft (Upcoming)"
            value={s.draftContests}
          />
          <StatCard
            icon={<Trophy className="w-5 h-5 text-gold" />}
            label="Leaderboard Entries"
            value={s.totalLeaderboardEntries}
          />
          <StatCard
            icon={<Brain className="w-5 h-5 text-purple-400" />}
            label="AI Identified"
            value={s.identifiedEntries}
          />
          <StatCard
            icon={<Sparkles className="w-5 h-5 text-gold" />}
            label="ID Rate"
            value={
              s.totalLeaderboardEntries > 0
                ? `${Math.round((s.identifiedEntries / s.totalLeaderboardEntries) * 100)}%`
                : "—"
            }
          />
        </div>
      ) : null}

      {/* Recent Scrape Jobs */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Recent Scrape Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : jobs.data && jobs.data.length > 0 ? (
            <div className="space-y-2">
              {jobs.data.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                >
                  <div className="flex items-center gap-3">
                    <JobStatusIcon status={job.status ?? "pending"} />
                    <div>
                      <p className="text-sm font-medium capitalize">{job.jobType.replace("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {job.startedAt
                          ? new Date(job.startedAt).toLocaleString()
                          : "Pending"}
                        {job.completedAt && job.startedAt && (
                          <span className="ml-2 text-teal">
                            ({Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {job.contestsProcessed ? (
                      <Badge variant="secondary">{job.contestsProcessed} contests</Badge>
                    ) : null}
                    {job.entriesProcessed ? (
                      <Badge variant="secondary">{job.entriesProcessed} entries</Badge>
                    ) : null}
                    {job.aiProcessed ? (
                      <Badge variant="secondary" className="bg-purple-500/20 text-purple-300">
                        {job.aiProcessed} AI
                      </Badge>
                    ) : null}
                    <Badge
                      variant={
                        job.status === "completed"
                          ? "default"
                          : job.status === "failed"
                            ? "destructive"
                            : job.status === "running"
                              ? "secondary"
                              : "secondary"
                      }
                      className={
                        job.status === "completed"
                          ? "bg-green-600/20 text-green-300"
                          : job.status === "running"
                            ? "bg-teal/20 text-teal animate-pulse"
                            : ""
                      }
                    >
                      {job.status === "running" ? "⚡ Running" : job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No scrape jobs yet. Click "Scrape Contests" to start collecting data.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Info */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><strong className="text-foreground">1. Scrape Contests</strong> — Fetches all contests (COMPLETED, LIVE, OPEN, DRAFT) from the Grand Arena Fantasy API and stores leaderboard data.</p>
            <p><strong className="text-foreground">2. AI Identify Cards</strong> — Uses AI vision to identify which champions and scheme cards are in winning lineup thumbnails.</p>
            <p><strong className="text-foreground">3. Analyze Patterns</strong> — View winning lineups categorized by contest type, rarity restrictions, and format to find proven combinations.</p>
            <p><strong className="text-foreground">4. Build Lineups</strong> — Use the optimizer to build optimal lineups for upcoming contests based on your owned cards.</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Scoring (V4)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><strong className="text-gold">85 pts</strong> per kill</p>
            <p><strong className="text-gold">40 pts</strong> per ball collected</p>
            <p><strong className="text-gold">+200 pts</strong> bonus per win</p>
            <p><strong className="text-gold">Wart riding</strong> — distance-based chunks</p>
            <div className="pt-2 border-t border-border/50">
              <p className="font-medium text-foreground mb-1">Rarity Multipliers:</p>
              <div className="flex gap-3 flex-wrap">
                <Badge className="bg-rarity-basic text-rarity-basic border-0">Common 1.0x</Badge>
                <Badge className="bg-rarity-rare text-rarity-rare border-0">Rare 1.25x</Badge>
                <Badge className="bg-rarity-epic text-rarity-epic border-0">Epic 1.5x</Badge>
                <Badge className="bg-rarity-legendary text-rarity-legendary border-0">Legendary 1.75x</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <Card className={`glass-card ${highlight ? "border-gold/30" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${highlight ? "text-gold" : ""}`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-5 h-5 text-green-400" />;
    case "failed":
      return <XCircle className="w-5 h-5 text-destructive" />;
    case "running":
      return <Loader2 className="w-5 h-5 text-teal animate-spin" />;
    default:
      return <Clock className="w-5 h-5 text-muted-foreground" />;
  }
}
