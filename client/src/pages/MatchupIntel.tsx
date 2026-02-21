/**
 * Matchup Intelligence — Head-to-head champion matchup analysis from real match data.
 * Features: Data scraping controls, champion search, H2H lookup, best/worst matchups,
 * class matchup matrix, and performance rankings from actual match results.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Loader2,
  Search,
  Swords,
  Trophy,
  Target,
  Database,
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  BarChart3,
  Shield,
  Zap,
  Bug,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ─── Scrape Control Panel ──────────────────────────────────────────

function ScrapePanel() {
  const progress = trpc.matchup.scrapeProgress.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const summary = trpc.matchup.dataSummary.useQuery(undefined, {
    refetchInterval: progress.data?.isRunning ? 5000 : false,
  });

  const startScrape = trpc.matchup.startScrape.useMutation({
    onSuccess: () => {
      toast.success("Match history scrape started!");
      progress.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const stopScrape = trpc.matchup.stopScrape.useMutation({
    onSuccess: () => {
      toast.info("Scrape stopping...");
      progress.refetch();
    },
  });

  const p = progress.data;
  const s = summary.data;
  const isRunning = p?.isRunning ?? false;
  const pct =
    p && p.totalChampions > 0
      ? Math.round((p.championsCompleted / p.totalChampions) * 100)
      : 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="w-4 h-4 text-teal" />
          Match Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold text-gold">
              {s?.totalMatches?.toLocaleString() ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">Matches</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold text-teal">
              {s?.uniqueChampions ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">Champions</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold text-foreground">
              {s?.totalPlayerStats?.toLocaleString() ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Player Stats
            </div>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold text-foreground">
              {p?.championsCompleted ?? 0}/{p?.totalChampions ?? 179}
            </div>
            <div className="text-[11px] text-muted-foreground">Scraped</div>
          </div>
        </div>

        {/* Win type breakdown */}
        {s?.winTypeBreakdown &&
          Object.keys(s.winTypeBreakdown).length > 0 && (
            <div className="flex gap-3 text-xs">
              {Object.entries(s.winTypeBreakdown).map(([type, count]) => (
                <div key={type} className="flex items-center gap-1">
                  {type === "eliminations" && (
                    <Swords className="w-3 h-3 text-red-400" />
                  )}
                  {type === "wart" && (
                    <Bug className="w-3 h-3 text-green-400" />
                  )}
                  {type === "gacha" && (
                    <Zap className="w-3 h-3 text-yellow-400" />
                  )}
                  <span className="text-muted-foreground capitalize">
                    {type}:
                  </span>
                  <span className="font-medium">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

        {/* Progress bar */}
        {isRunning && (
          <div className="space-y-2">
            <Progress value={pct} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {p?.currentChampion
                  ? `Scraping: ${p.currentChampion} (page ${p.currentPage})`
                  : "Starting..."}
              </span>
              <span>
                {pct}% · {p?.estimatedTimeRemaining ?? "calculating..."}
              </span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2">
          {!isRunning ? (
            <Button
              onClick={() => startScrape.mutate()}
              disabled={startScrape.isPending}
              className="bg-teal text-background hover:bg-teal/90"
              size="sm"
            >
              {startScrape.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              )}
              Scrape Match History
            </Button>
          ) : (
            <Button
              onClick={() => stopScrape.mutate()}
              variant="destructive"
              size="sm"
            >
              <Square className="w-3.5 h-3.5 mr-1.5" />
              Stop Scrape
            </Button>
          )}
        </div>

        {/* Date range */}
        {s?.dateRange?.earliest && (
          <p className="text-[11px] text-muted-foreground">
            Data range: {s.dateRange.earliest} to {s.dateRange.latest}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Champion Search Autocomplete ──────────────────────────────────

function ChampionSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  const searchResults = trpc.matchup.searchChampions.useQuery(
    { query, limit: 10 },
    { enabled: query.length >= 2 }
  );

  return (
    <div className="relative">
      <label className="text-xs text-muted-foreground mb-1 block">
        {label}
      </label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search champion..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
            if (e.target.value.length < 2) onChange(null, "");
          }}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          className="pl-8 h-9 text-sm bg-secondary/50"
        />
      </div>
      {showResults && searchResults.data && searchResults.data.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {searchResults.data.map((c) => (
            <button
              key={c.championTokenId}
              className="w-full text-left px-3 py-2 hover:bg-secondary/50 text-sm flex items-center justify-between"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(c.championName);
                setShowResults(false);
                onChange(c.championTokenId, c.championName);
              }}
            >
              <span>
                <span className="font-medium">{c.championName}</span>
                <span className="text-muted-foreground ml-1.5 text-xs">
                  #{c.championTokenId}
                </span>
              </span>
              <Badge variant="outline" className="text-[10px] h-5">
                {c.championClass || "?"}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Head-to-Head Comparison ───────────────────────────────────────

function HeadToHeadPanel() {
  const [champId, setChampId] = useState<number | null>(null);
  const [champName, setChampName] = useState("");
  const [oppId, setOppId] = useState<number | null>(null);
  const [oppName, setOppName] = useState("");

  const h2h = trpc.matchup.headToHead.useQuery(
    { championTokenId: champId!, opponentTokenId: oppId! },
    { enabled: !!champId && !!oppId }
  );

  const record = h2h.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ChampionSearch
          label="Champion"
          value={champId}
          onChange={(id, name) => {
            setChampId(id);
            setChampName(name);
          }}
        />
        <ChampionSearch
          label="Opponent"
          value={oppId}
          onChange={(id, name) => {
            setOppId(id);
            setOppName(name);
          }}
        />
      </div>

      {h2h.isLoading && champId && oppId && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {record && (
        <Card className="border-border/50">
          <CardContent className="pt-4 space-y-4">
            {/* VS Header */}
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="font-bold text-gold text-lg">
                  {record.championName}
                </div>
                <Badge variant="outline" className="text-xs mt-1">
                  {record.championClass}
                </Badge>
              </div>
              <div className="px-4 text-center">
                <Swords className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                <div className="text-xs text-muted-foreground">
                  {record.totalMatches} matches
                </div>
              </div>
              <div className="text-center flex-1">
                <div className="font-bold text-teal text-lg">
                  {record.opponentName}
                </div>
                <Badge variant="outline" className="text-xs mt-1">
                  {record.opponentClass}
                </Badge>
              </div>
            </div>

            {/* Win/Loss bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gold font-bold">{record.wins}W</span>
                <span
                  className={`font-bold ${
                    record.winRate >= 50 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {record.winRate}%
                </span>
                <span className="text-teal font-bold">{record.losses}L</span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-secondary">
                <div
                  className="bg-gold transition-all"
                  style={{
                    width: `${record.totalMatches > 0 ? (record.wins / record.totalMatches) * 100 : 50}%`,
                  }}
                />
                <div
                  className="bg-teal transition-all"
                  style={{
                    width: `${record.totalMatches > 0 ? (record.losses / record.totalMatches) * 100 : 50}%`,
                  }}
                />
              </div>
            </div>

            {/* Stat comparison */}
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <StatCompare
                label="Avg Kills"
                champVal={record.avgKills}
                oppVal={record.avgOpponentKills}
              />
              <StatCompare
                label="Avg Balls"
                champVal={record.avgBalls}
                oppVal={record.avgOpponentBalls}
              />
              <StatCompare
                label="Avg Wart"
                champVal={record.avgWartDistance}
                oppVal={record.avgOpponentWartDistance}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {champId && oppId && !h2h.isLoading && !record && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No head-to-head data found. These champions may not have faced each
          other on opposing teams.
        </div>
      )}
    </div>
  );
}

function StatCompare({
  label,
  champVal,
  oppVal,
}: {
  label: string;
  champVal: number;
  oppVal: number;
}) {
  const champBetter = champVal > oppVal;
  return (
    <div className="p-2 rounded-lg bg-secondary/30">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="flex justify-between items-center gap-1">
        <span
          className={`font-mono text-sm ${champBetter ? "text-gold font-bold" : "text-foreground"}`}
        >
          {champVal.toFixed(1)}
        </span>
        <span className="text-muted-foreground text-[10px]">vs</span>
        <span
          className={`font-mono text-sm ${!champBetter ? "text-teal font-bold" : "text-foreground"}`}
        >
          {oppVal.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

// ─── Champion Matchup Profile ──────────────────────────────────────

function ChampionMatchupProfile() {
  const [champId, setChampId] = useState<number | null>(null);
  const [champName, setChampName] = useState("");

  const performance = trpc.matchup.championPerformance.useQuery(
    { championTokenId: champId! },
    { enabled: !!champId }
  );

  const bestWorst = trpc.matchup.bestWorstMatchups.useQuery(
    { championTokenId: champId!, minMatches: 2 },
    { enabled: !!champId }
  );

  const perf = performance.data;

  return (
    <div className="space-y-4">
      <ChampionSearch
        label="Select Champion"
        value={champId}
        onChange={(id, name) => {
          setChampId(id);
          setChampName(name);
        }}
      />

      {performance.isLoading && champId && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {perf && (
        <>
          {/* Performance Overview */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gold" />
                {perf.championName}
                <Badge variant="outline" className="text-xs ml-auto">
                  {perf.championClass}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-2 rounded-lg bg-secondary/50">
                  <div className="text-lg font-bold text-gold">
                    {perf.winRate}%
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Win Rate
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-secondary/50">
                  <div className="text-lg font-bold">
                    {perf.wins}
                    <span className="text-muted-foreground text-sm">
                      /{perf.totalMatches}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    W/Total
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-secondary/50">
                  <div className="text-lg font-bold text-teal">
                    {perf.avgEstimatedScore}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Est. Score
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-secondary/50">
                  <div className="text-lg font-bold">
                    {perf.totalMatches}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Matches
                  </div>
                </div>
              </div>

              {/* Per-match averages */}
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="text-center p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Swords className="w-3 h-3 text-red-400" />
                    <span className="text-[11px] text-muted-foreground">
                      Kills
                    </span>
                  </div>
                  <div className="font-mono font-bold">
                    {perf.avgKills.toFixed(2)}
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Target className="w-3 h-3 text-blue-400" />
                    <span className="text-[11px] text-muted-foreground">
                      Balls
                    </span>
                  </div>
                  <div className="font-mono font-bold">
                    {perf.avgBalls.toFixed(2)}
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Bug className="w-3 h-3 text-green-400" />
                    <span className="text-[11px] text-muted-foreground">
                      Wart
                    </span>
                  </div>
                  <div className="font-mono font-bold">
                    {perf.avgWartDistance.toFixed(1)}
                  </div>
                </div>
              </div>

              {/* Win type breakdown */}
              {(perf.eliminationWins > 0 ||
                perf.wartWins > 0 ||
                perf.gachaWins > 0) && (
                <div className="flex gap-3 mt-3 text-xs justify-center">
                  <span className="text-muted-foreground">Win types:</span>
                  {perf.eliminationWins > 0 && (
                    <span className="text-red-400">
                      Elim {perf.eliminationWins}
                    </span>
                  )}
                  {perf.wartWins > 0 && (
                    <span className="text-green-400">
                      Wart {perf.wartWins}
                    </span>
                  )}
                  {perf.gachaWins > 0 && (
                    <span className="text-yellow-400">
                      Gacha {perf.gachaWins}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Best & Worst Matchups */}
          {bestWorst.data && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MatchupList
                title="Best Matchups"
                icon={<TrendingUp className="w-4 h-4 text-green-400" />}
                matchups={bestWorst.data.bestMatchups}
                colorClass="text-green-400"
              />
              <MatchupList
                title="Worst Matchups"
                icon={<TrendingDown className="w-4 h-4 text-red-400" />}
                matchups={bestWorst.data.worstMatchups}
                colorClass="text-red-400"
              />
            </div>
          )}
        </>
      )}

      {champId && !performance.isLoading && !perf && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No match data found for this champion. Run the scraper first.
        </div>
      )}
    </div>
  );
}

function MatchupList({
  title,
  icon,
  matchups,
  colorClass,
}: {
  title: string;
  icon: React.ReactNode;
  matchups: any[];
  colorClass: string;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {matchups.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Not enough data (need 2+ matches vs same opponent)
          </p>
        ) : (
          <div className="space-y-1.5">
            {matchups.map((m, i) => (
              <div
                key={m.opponentTokenId}
                className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-secondary/20 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground text-xs w-4">
                    {i + 1}
                  </span>
                  <span className="font-medium truncate">
                    {m.opponentName}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 shrink-0"
                  >
                    {m.opponentClass || "?"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {m.wins}W-{m.losses}L
                  </span>
                  <span className={`font-mono font-bold text-sm ${colorClass}`}>
                    {m.winRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Class Matchup Matrix ──────────────────────────────────────────

function ClassMatchupMatrix() {
  const classMatchups = trpc.matchup.classMatchups.useQuery();

  const matrix = useMemo(() => {
    if (!classMatchups.data) return null;

    const classes = new Set<string>();
    const data = new Map<string, { winRate: number; total: number }>();

    for (const m of classMatchups.data) {
      if (m.className && m.opponentClass) {
        classes.add(m.className);
        classes.add(m.opponentClass);
        data.set(`${m.className}_${m.opponentClass}`, {
          winRate: m.winRate,
          total: m.totalMatches,
        });
      }
    }

    return { classes: Array.from(classes).sort(), data };
  }, [classMatchups.data]);

  if (classMatchups.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!matrix || matrix.classes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No class matchup data available. Run the scraper first.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left p-2 text-muted-foreground font-normal sticky left-0 bg-background z-10">
              Class ↓ vs →
            </th>
            {matrix.classes.map((c) => (
              <th
                key={c}
                className="p-2 text-center text-muted-foreground font-normal whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.classes.map((row) => (
            <tr key={row} className="border-t border-border/30">
              <td className="p-2 font-medium sticky left-0 bg-background z-10 whitespace-nowrap">
                {row}
              </td>
              {matrix.classes.map((col) => {
                const cell = matrix.data.get(`${row}_${col}`);
                if (!cell || row === col) {
                  return (
                    <td
                      key={col}
                      className="p-2 text-center text-muted-foreground/30"
                    >
                      {row === col ? "—" : "?"}
                    </td>
                  );
                }
                const wr = cell.winRate;
                const bg =
                  wr >= 55
                    ? "bg-green-500/20 text-green-400"
                    : wr >= 50
                      ? "bg-secondary/30 text-foreground"
                      : wr >= 45
                        ? "bg-secondary/30 text-foreground"
                        : "bg-red-500/20 text-red-400";
                return (
                  <td key={col} className={`p-2 text-center font-mono ${bg}`}>
                    {wr.toFixed(1)}%
                    <div className="text-[9px] text-muted-foreground">
                      {cell.total}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Performance Rankings ──────────────────────────────────────────

function PerformanceRankings() {
  const [sortBy, setSortBy] = useState<
    "winRate" | "avgKills" | "avgBalls" | "avgWart" | "totalMatches"
  >("winRate");
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 25;

  const rankings = trpc.matchup.performanceRankings.useQuery({
    sortBy,
    limit: PAGE_SIZE,
    offset,
    minMatches: 5,
  });

  const data = rankings.data;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      {/* Sort controls */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: "winRate" as const, label: "Win Rate" },
          { value: "avgKills" as const, label: "Kills" },
          { value: "avgBalls" as const, label: "Balls" },
          { value: "avgWart" as const, label: "Wart" },
          { value: "totalMatches" as const, label: "Matches" },
        ].map((opt) => (
          <Button
            key={opt.value}
            variant={sortBy === opt.value ? "default" : "outline"}
            size="sm"
            className={
              sortBy === opt.value
                ? "bg-gold text-background"
                : "border-border/50"
            }
            onClick={() => {
              setSortBy(opt.value);
              setOffset(0);
            }}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {rankings.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && data.champions.length > 0 ? (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground text-xs">
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Champion</th>
                  <th className="text-left p-2 hidden sm:table-cell">Class</th>
                  <th className="text-right p-2">Win%</th>
                  <th className="text-right p-2">Kills</th>
                  <th className="text-right p-2">Balls</th>
                  <th className="text-right p-2 hidden sm:table-cell">Wart</th>
                  <th className="text-right p-2 hidden sm:table-cell">
                    Matches
                  </th>
                  <th className="text-right p-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.champions.map((c, i) => (
                  <tr
                    key={c.championTokenId}
                    className="border-b border-border/10 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="p-2 text-muted-foreground">
                      {offset + i + 1}
                    </td>
                    <td className="p-2 font-medium">{c.championName}</td>
                    <td className="p-2 hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] h-5">
                        {c.championClass || "?"}
                      </Badge>
                    </td>
                    <td
                      className={`p-2 text-right font-mono font-bold ${
                        c.winRate >= 55
                          ? "text-green-400"
                          : c.winRate >= 50
                            ? "text-foreground"
                            : "text-red-400"
                      }`}
                    >
                      {c.winRate}%
                    </td>
                    <td className="p-2 text-right font-mono">
                      {c.avgKills.toFixed(2)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {c.avgBalls.toFixed(2)}
                    </td>
                    <td className="p-2 text-right font-mono hidden sm:table-cell">
                      {c.avgWartDistance.toFixed(1)}
                    </td>
                    <td className="p-2 text-right text-muted-foreground hidden sm:table-cell">
                      {c.totalMatches}
                    </td>
                    <td className="p-2 text-right font-mono text-teal font-bold">
                      {c.avgEstimatedScore.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-xs">
                Page {currentPage} of {totalPages} · {data.total} champions
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No performance data available. Run the scraper first.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

export default function MatchupIntel() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-gold">
          Matchup Intelligence
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Head-to-head champion matchup data from real match history
        </p>
      </div>

      {/* Scrape Control */}
      <ScrapePanel />

      {/* Tabs */}
      <Tabs defaultValue="h2h" className="w-full">
        <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:flex bg-secondary/50">
          <TabsTrigger value="h2h" className="text-xs sm:text-sm">
            <Swords className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
            H2H
          </TabsTrigger>
          <TabsTrigger value="profile" className="text-xs sm:text-sm">
            <BarChart3 className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="class" className="text-xs sm:text-sm">
            <Shield className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
            Classes
          </TabsTrigger>
          <TabsTrigger value="rankings" className="text-xs sm:text-sm">
            <Trophy className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
            Rankings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="h2h" className="mt-4">
          <HeadToHeadPanel />
        </TabsContent>

        <TabsContent value="profile" className="mt-4">
          <ChampionMatchupProfile />
        </TabsContent>

        <TabsContent value="class" className="mt-4">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4 text-teal" />
                Class vs Class Win Rates
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Win rate when class (row) faces class (column) on opposing teams
              </p>
            </CardHeader>
            <CardContent>
              <ClassMatchupMatrix />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rankings" className="mt-4">
          <PerformanceRankings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
