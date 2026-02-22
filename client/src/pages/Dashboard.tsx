/**
 * Dashboard — Main overview page showing contest stats, scrape status, and quick actions.
 * Uses non-blocking scrape with auto-polling for real-time progress.
 * Fully mobile responsive.
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
  Timer,
  Play,
  Square,
  Zap,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function Dashboard() {
  const [scraping, setScraping] = useState(false);
  const [identifying, setIdentifying] = useState(false);

  const stats = trpc.contests.stats.useQuery(undefined, {
    refetchInterval: scraping || identifying ? 3000 : false,
  });
  const jobs = trpc.contests.scrapeJobs.useQuery({ limit: 5 }, {
    refetchInterval: scraping || identifying ? 3000 : false,
  });
  const utils = trpc.useUtils();

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
          toast.error("Scrape Failed", { description: latestJob.errorMessage ?? "Unknown error" });
        }
        setScraping(false);
      }
      if (identifying) {
        if (latestJob.status === "completed") {
          toast.success("AI Identification Complete!", {
            description: `${latestJob.aiProcessed ?? 0} entries identified.`,
          });
        } else {
          toast.error("Identification Failed", { description: latestJob.errorMessage ?? "Unknown error" });
        }
        setIdentifying(false);
      }
    }
  }, [jobs.data, scraping, identifying]);

  const triggerScrape = trpc.contests.triggerScrape.useMutation({
    onSuccess: () => {
      toast.info("Scrape Started", {
        description: "Fetching contests and leaderboards in the background.",
      });
    },
    onError: (err) => {
      toast.error("Failed to Start Scrape", { description: err.message });
      setScraping(false);
    },
  });

  const triggerIdentification = trpc.contests.triggerIdentification.useMutation({
    onSuccess: () => {
      toast.info("AI Identification Started", {
        description: "Analyzing card thumbnails in the background.",
      });
    },
    onError: (err) => {
      toast.error("Failed to Start Identification", { description: err.message });
      setIdentifying(false);
    },
  });

  const handleScrape = () => { setScraping(true); triggerScrape.mutate(); };
  const handleIdentify = () => { setIdentifying(true); triggerIdentification.mutate({ topN: 10 }); };

  const s = stats.data;
  const latestJob = jobs.data?.[0];
  const jobRunning = latestJob?.status === "running";

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Dashboard</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Contest data collection and winning lineup analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleScrape}
            disabled={scraping || jobRunning}
            className="bg-teal hover:bg-teal/90 text-background flex-1 sm:flex-none h-10 text-xs sm:text-sm"
          >
            {scraping || jobRunning ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1.5" />
            )}
            {scraping || jobRunning ? "Scraping..." : "Scrape"}
          </Button>
          <Button
            onClick={handleIdentify}
            disabled={identifying || jobRunning}
            variant="outline"
            className="border-gold/30 text-gold hover:bg-gold/10 flex-1 sm:flex-none h-10 text-xs sm:text-sm"
          >
            {identifying ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 mr-1.5" />
            )}
            {identifying ? "Identifying..." : "AI Identify"}
          </Button>
        </div>
      </div>

      {/* Progress Banner */}
      {(scraping || identifying || jobRunning) && (
        <Card className="glass-card border-teal/30 bg-teal/5">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start sm:items-center gap-3">
              <Loader2 className="w-5 h-5 text-teal animate-spin flex-shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <p className="text-sm font-medium text-teal">
                  {scraping || (jobRunning && latestJob?.jobType === "contests")
                    ? "Scraping contests and leaderboards..."
                    : "Running AI identification..."}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stats update every 3s. May take 1-3 min.
                  {s && (
                    <span className="block sm:inline sm:ml-2 text-teal">
                      {s.totalContests} contests · {s.totalLeaderboardEntries.toLocaleString()} entries
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-3 sm:p-4">
                <div className="h-4 bg-muted rounded w-20 mb-2" />
                <div className="h-7 bg-muted rounded w-14" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard icon={<Database className="w-4 h-4 sm:w-5 sm:h-5 text-teal" />} label="Total Contests" value={s.totalContests} />
          <StatCard icon={<CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />} label="Completed" value={s.completedContests} />
          <StatCard icon={<Swords className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />} label="Live" value={s.liveContests} highlight />
          <StatCard icon={<Clock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />} label="Open" value={s.openContests} />
          <StatCard icon={<AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />} label="Draft" value={s.draftContests} />
          <StatCard icon={<Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />} label="Entries" value={s.totalLeaderboardEntries} />
          <StatCard icon={<Brain className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />} label="AI ID'd" value={s.identifiedEntries} />
          <StatCard
            icon={<Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />}
            label="ID Rate"
            value={s.totalLeaderboardEntries > 0 ? `${Math.round((s.identifiedEntries / s.totalLeaderboardEntries) * 100)}%` : "—"}
          />
        </div>
      ) : null}

      {/* Recent Scrape Jobs */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
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
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-background/50 border border-border/50 gap-2"
                >
                  <div className="flex items-center gap-3">
                    <JobStatusIcon status={job.status ?? "pending"} />
                    <div>
                      <p className="text-sm font-medium capitalize">{job.jobType.replace("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {job.startedAt ? new Date(job.startedAt).toLocaleString() : "Pending"}
                        {job.completedAt && job.startedAt && (
                          <span className="ml-2 text-teal">
                            ({Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap ml-8 sm:ml-0">
                    {job.contestsProcessed ? (
                      <Badge variant="secondary" className="text-xs">{job.contestsProcessed} contests</Badge>
                    ) : null}
                    {job.entriesProcessed ? (
                      <Badge variant="secondary" className="text-xs">{job.entriesProcessed} entries</Badge>
                    ) : null}
                    {job.aiProcessed ? (
                      <Badge variant="secondary" className="bg-purple-500/20 text-purple-300 text-xs">
                        {job.aiProcessed} AI
                      </Badge>
                    ) : null}
                    <Badge
                      variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"}
                      className={`text-xs ${
                        job.status === "completed" ? "bg-green-600/20 text-green-300"
                        : job.status === "running" ? "bg-teal/20 text-teal animate-pulse" : ""
                      }`}
                    >
                      {job.status === "running" ? "Running" : job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scrape jobs yet. Click "Scrape" to start.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Match History Cron Status */}
      <MatchCronCard />

      {/* Quick Info */}
      <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="text-xs sm:text-sm text-muted-foreground space-y-2">
            <p><strong className="text-foreground">1. Scrape</strong> — Fetches all contests from the GA Fantasy API and stores leaderboard data.</p>
            <p><strong className="text-foreground">2. AI Identify</strong> — Uses AI vision to identify champions in winning lineup thumbnails.</p>
            <p><strong className="text-foreground">3. Analyze</strong> — View winning lineups by contest type to find proven combinations.</p>
            <p><strong className="text-foreground">4. Build</strong> — Optimize lineups for upcoming contests based on your cards.</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Scoring (V4)</CardTitle>
          </CardHeader>
          <CardContent className="text-xs sm:text-sm text-muted-foreground space-y-2">
            <p><strong className="text-gold">85 pts</strong> per kill</p>
            <p><strong className="text-gold">40 pts</strong> per ball</p>
            <p><strong className="text-gold">+200 pts</strong> win bonus</p>
            <p><strong className="text-gold">Wart</strong> — distance chunks</p>
            <div className="pt-2 border-t border-border/50">
              <p className="font-medium text-foreground mb-1">Rarity Multipliers:</p>
              <div className="flex gap-2 flex-wrap">
                <Badge className="bg-rarity-basic text-rarity-basic border-0 text-xs">Common 1.0x</Badge>
                <Badge className="bg-rarity-rare text-rarity-rare border-0 text-xs">Rare 1.25x</Badge>
                <Badge className="bg-rarity-epic text-rarity-epic border-0 text-xs">Epic 1.5x</Badge>
                <Badge className="bg-rarity-legendary text-rarity-legendary border-0 text-xs">Legendary 1.75x</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: number | string; highlight?: boolean }) {
  return (
    <Card className={`glass-card ${highlight ? "border-gold/30" : ""}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
          {icon}
          <span className="text-[10px] sm:text-xs text-muted-foreground truncate">{label}</span>
        </div>
        <p className={`text-lg sm:text-2xl font-bold ${highlight ? "text-gold" : ""}`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function MatchCronCard() {
  const cronStatus = trpc.matchup.cronStatus.useQuery(undefined, {
    refetchInterval: 30000, // refresh every 30s
  });
  const triggerIncremental = trpc.matchup.triggerIncrementalScrape.useMutation({
    onSuccess: () => toast.info("Incremental match scrape started"),
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });
  const startCron = trpc.matchup.startCron.useMutation({
    onSuccess: () => { toast.success("Cron started"); cronStatus.refetch(); },
  });
  const stopCron = trpc.matchup.stopCron.useMutation({
    onSuccess: () => { toast.info("Cron stopped"); cronStatus.refetch(); },
  });

  const cs = cronStatus.data;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Timer className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
            Match History Cron
          </CardTitle>
          <div className="flex items-center gap-2">
            {cs?.cronActive ? (
              <Badge className="bg-green-600/20 text-green-300 text-xs">Active</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">Inactive</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {cronStatus.isLoading ? (
          <div className="h-16 bg-muted/30 rounded animate-pulse" />
        ) : cs ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-medium">
                  {cs.isRunning ? (
                    <span className="text-teal flex items-center justify-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Running
                    </span>
                  ) : cs.cronActive ? (
                    <span className="text-green-400">Idle</span>
                  ) : (
                    <span className="text-muted-foreground">Stopped</span>
                  )}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Last Run</p>
                <p className="text-sm font-medium">
                  {cs.lastRun ? new Date(cs.lastRun).toLocaleTimeString() : "Never"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Next Run</p>
                <p className="text-sm font-medium">
                  {cs.nextRun ? new Date(cs.nextRun).toLocaleTimeString() : "—"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">New Matches</p>
                <p className="text-sm font-medium text-gold">
                  {cs.lastResult ? `+${cs.lastResult.newMatchesFound}` : "—"}
                </p>
              </div>
            </div>

            {cs.lastResult && (
              <div className="text-xs text-muted-foreground bg-background/50 rounded-lg p-2">
                Last run: {cs.lastResult.championsChecked} champions checked,{" "}
                {cs.lastResult.newMatchesFound} new matches,{" "}
                {Math.round(cs.lastResult.duration / 1000)}s duration
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 border-gold/30 text-gold hover:bg-gold/10"
                onClick={() => triggerIncremental.mutate()}
                disabled={cs.isRunning || triggerIncremental.isPending}
              >
                <Zap className="w-3 h-3 mr-1" />
                Run Now
              </Button>
              {cs.cronActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => stopCron.mutate()}
                  disabled={stopCron.isPending}
                >
                  <Square className="w-3 h-3 mr-1" />
                  Stop Cron
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-green-500/30 text-green-400 hover:bg-green-500/10"
                  onClick={() => startCron.mutate()}
                  disabled={startCron.isPending}
                >
                  <Play className="w-3 h-3 mr-1" />
                  Start Cron
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load cron status.</p>
        )}
      </CardContent>
    </Card>
  );
}

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400 flex-shrink-0" />;
    case "failed": return <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-destructive flex-shrink-0" />;
    case "running": return <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-teal animate-spin flex-shrink-0" />;
    default: return <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground flex-shrink-0" />;
  }
}
