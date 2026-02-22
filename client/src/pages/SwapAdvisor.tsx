/**
 * Swap Advisor — Post-entry lineup optimization.
 *
 * Two modes:
 * 1. Contest Mode (auto): Pick a contest you've entered → auto-loads your lineup →
 *    browse opponents from leaderboard → one-click swap analysis.
 * 2. Manual Mode: Enter 4+4 MOKIs by hand for quick ad-hoc checks.
 */

import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Minus,
  Swords,
  Shield,
  Target,
  ChevronRight,
  Sparkles,
  Info,
  Trophy,
  Users,
  Zap,
  ListChecks,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import type { GameData } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface ChampionSlot {
  tokenId: number | null;
  name: string;
}

type AdvisorMode = "contest" | "manual";

// ─── Champion Search (reusable autocomplete from game data) ────────

function ChampionPicker({
  label,
  position,
  value,
  onChange,
  gameData,
}: {
  label: string;
  position: number;
  value: ChampionSlot;
  onChange: (slot: ChampionSlot) => void;
  gameData: GameData | undefined;
}) {
  const [query, setQuery] = useState(value.name);
  const [showResults, setShowResults] = useState(false);

  const dbSearch = trpc.matchup.searchChampions.useQuery(
    { query, limit: 10 },
    { enabled: query.length >= 2 }
  );

  const results = useMemo(() => {
    const seen = new Set<number>();
    const combined: Array<{
      tokenId: number;
      name: string;
      championClass: string;
      source: string;
    }> = [];

    if (dbSearch.data) {
      for (const c of dbSearch.data) {
        if (!seen.has(c.championTokenId)) {
          seen.add(c.championTokenId);
          combined.push({
            tokenId: c.championTokenId,
            name: c.championName,
            championClass: c.championClass,
            source: `${c.totalMatches} matches`,
          });
        }
      }
    }

    if (gameData?.champions && query.length >= 2) {
      const q = query.toLowerCase();
      for (const c of gameData.champions) {
        const tid = Number(c.tokenId);
        if (!isNaN(tid) && !seen.has(tid) && c.name?.toLowerCase().includes(q)) {
          seen.add(tid);
          combined.push({
            tokenId: tid,
            name: c.name,
            championClass: c.class ?? "Unknown",
            source: "game data",
          });
        }
      }
    }

    return combined.slice(0, 12);
  }, [dbSearch.data, gameData, query]);

  useEffect(() => {
    setQuery(value.name);
  }, [value.name]);

  return (
    <div className="relative">
      <label className="text-[11px] text-muted-foreground mb-1 block font-medium">
        {label} · Match {position}
      </label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search MOKI..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
            if (e.target.value.length < 2) onChange({ tokenId: null, name: "" });
          }}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          className="pl-8 h-9 text-sm bg-secondary/50"
        />
        {value.tokenId && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery("");
              onChange({ tokenId: null, name: "" });
            }}
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.tokenId}
              className="w-full text-left px-3 py-2 hover:bg-secondary/50 text-sm flex items-center justify-between"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(c.name);
                setShowResults(false);
                onChange({ tokenId: c.tokenId, name: c.name });
              }}
            >
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground ml-1.5 text-[10px]">
                  #{c.tokenId}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] h-5">
                  {c.championClass}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{c.source}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Matchup Slot Display ──────────────────────────────────────────

function MatchupSlotCard({
  slot,
  position,
}: {
  slot: {
    yourChampionName: string;
    opponentChampionName: string;
    h2hWinRate: number;
    h2hMatches: number;
    h2hWins: number;
    h2hLosses: number;
    confidence: string;
    yourChampionClass: string;
    opponentChampionClass: string;
  };
  position: number;
}) {
  const winRate = slot.h2hWinRate;
  const isGood = winRate >= 55;
  const isBad = winRate < 45;

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        isGood
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isBad
            ? "border-destructive/30 bg-destructive/5"
            : "border-border/50 bg-secondary/20"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Match {position}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] h-5 ${
            slot.confidence === "high"
              ? "border-emerald-500/40 text-emerald-400"
              : slot.confidence === "medium"
                ? "border-gold/40 text-gold"
                : slot.confidence === "low"
                  ? "border-orange-500/40 text-orange-400"
                  : "border-muted-foreground/30 text-muted-foreground"
          }`}
        >
          {slot.confidence === "none" ? "no data" : `${slot.confidence} conf.`}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 text-right">
          <p className="text-sm font-semibold truncate">{slot.yourChampionName}</p>
          <p className="text-[10px] text-muted-foreground">{slot.yourChampionClass}</p>
        </div>

        <div className="flex flex-col items-center px-2">
          <div
            className={`text-lg font-bold tabular-nums ${
              isGood ? "text-emerald-400" : isBad ? "text-destructive" : "text-foreground"
            }`}
          >
            {winRate.toFixed(1)}%
          </div>
          <span className="text-[9px] text-muted-foreground">
            {slot.h2hMatches > 0
              ? `${slot.h2hWins}W-${slot.h2hLosses}L`
              : "est."}
          </span>
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold truncate">{slot.opponentChampionName}</p>
          <p className="text-[10px] text-muted-foreground">{slot.opponentChampionClass}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Swap Recommendation Card ──────────────────────────────────────

function SwapCard({
  rec,
}: {
  rec: {
    position: number;
    currentChampionName: string;
    currentWinRate: number;
    currentH2hMatches: number;
    suggestedChampionName: string;
    suggestedChampionClass: string;
    suggestedWinRate: number;
    suggestedH2hMatches: number;
    winRateImprovement: number;
    reason: string;
    confidence: string;
  };
}) {
  return (
    <Card className="border-gold/30 bg-gold/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-gold" />
            <span className="text-sm font-semibold">Match {rec.position} Swap</span>
          </div>
          <Badge
            className={`text-[10px] ${
              rec.confidence === "high"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : rec.confidence === "medium"
                  ? "bg-gold/20 text-gold border-gold/30"
                  : "bg-orange-500/20 text-orange-400 border-orange-500/30"
            }`}
            variant="outline"
          >
            {rec.confidence} confidence
          </Badge>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 p-2 rounded bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-sm font-semibold">{rec.currentChampionName}</p>
            <p className="text-xs text-destructive">
              {rec.currentWinRate.toFixed(1)}% WR
              {rec.currentH2hMatches > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {rec.currentH2hMatches} matches
                </span>
              )}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 text-gold shrink-0" />

          <div className="flex-1 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-xs text-muted-foreground">Swap In</p>
            <p className="text-sm font-semibold">{rec.suggestedChampionName}</p>
            <p className="text-xs text-emerald-400">
              {rec.suggestedWinRate.toFixed(1)}% WR
              {rec.suggestedH2hMatches > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {rec.suggestedH2hMatches} matches
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm font-bold text-emerald-400">
            +{rec.winRateImprovement.toFixed(1)}% win rate improvement
          </span>
        </div>

        <p className="text-xs text-muted-foreground">{rec.reason}</p>
      </CardContent>
    </Card>
  );
}

// ─── Analysis Results Display ──────────────────────────────────────

function AnalysisResults({
  result,
  contestName,
  entryNumber,
}: {
  result: {
    currentMatchups: Array<{
      position: number;
      yourChampionName: string;
      opponentChampionName: string;
      h2hWinRate: number;
      h2hMatches: number;
      h2hWins: number;
      h2hLosses: number;
      confidence: string;
      yourChampionClass: string;
      opponentChampionClass: string;
    }>;
    currentOverallWinRate: number;
    recommendations: Array<{
      position: number;
      currentChampionName: string;
      currentWinRate: number;
      currentH2hMatches: number;
      suggestedChampionName: string;
      suggestedChampionClass: string;
      suggestedWinRate: number;
      suggestedH2hMatches: number;
      winRateImprovement: number;
      reason: string;
      confidence: string;
    }>;
    bestPossibleWinRate: number;
    improvementPotential: number;
    dataQuality: {
      matchupsWithData: number;
      matchupsWithoutData: number;
      totalH2hMatchesUsed: number;
    };
  };
  contestName?: string;
  entryNumber?: number;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Context banner */}
      {contestName && (
        <div className="flex items-center gap-2 text-xs text-teal bg-teal/10 p-2.5 rounded-lg border border-teal/20">
          <Trophy className="w-3.5 h-3.5 shrink-0" />
          <span>
            Analyzing <span className="font-semibold">{contestName}</span>
            {entryNumber ? ` · Entry #${entryNumber}` : ""}
          </span>
        </div>
      )}

      {/* Overall Summary */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" />
            Analysis Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-secondary/30 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Current Win Rate</p>
              <p
                className={`text-xl font-bold tabular-nums ${
                  result.currentOverallWinRate >= 55
                    ? "text-emerald-400"
                    : result.currentOverallWinRate < 45
                      ? "text-destructive"
                      : "text-foreground"
                }`}
              >
                {result.currentOverallWinRate.toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Best Possible</p>
              <p className="text-xl font-bold tabular-nums text-emerald-400">
                {result.bestPossibleWinRate.toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Improvement</p>
              <p
                className={`text-xl font-bold tabular-nums ${
                  result.improvementPotential > 0 ? "text-gold" : "text-muted-foreground"
                }`}
              >
                {result.improvementPotential > 0 ? "+" : ""}
                {result.improvementPotential.toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-secondary/30 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Data Quality</p>
              <p className="text-xl font-bold tabular-nums">
                {result.dataQuality.matchupsWithData}/4
              </p>
              <p className="text-[10px] text-muted-foreground">
                {result.dataQuality.totalH2hMatchesUsed} H2H matches
              </p>
            </div>
          </div>

          {result.dataQuality.matchupsWithoutData > 0 && (
            <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 p-2 rounded">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {result.dataQuality.matchupsWithoutData} matchup
                {result.dataQuality.matchupsWithoutData > 1 ? "s" : ""} have no H2H data —
                using estimated win rates. Scrape more match history for better accuracy.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Matchups */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Swords className="w-4 h-4 text-teal" />
            Current Matchups
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {result.currentMatchups.map((slot, i) => (
              <MatchupSlotCard key={i} slot={slot} position={slot.position} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Swap Recommendations */}
      <Card className="border-gold/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-gold" />
            Swap Recommendations
            {result.recommendations.length > 0 && (
              <Badge
                className="bg-gold/20 text-gold border-gold/30 ml-1"
                variant="outline"
              >
                {result.recommendations.length} swap
                {result.recommendations.length > 1 ? "s" : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {result.recommendations.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium">Your lineup looks optimal!</p>
              <p className="text-xs text-muted-foreground mt-1">
                No swaps found that would improve your expected win rate by more than 3%.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.recommendations.map((rec, i) => (
                <SwapCard key={i} rec={rec} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Contest Mode: My Entries ──────────────────────────────────────

function ContestModePanel({
  gameData,
}: {
  gameData: GameData | undefined;
}) {
  const { isAuthenticated } = useAuth();

  // Fetch user's contest entries
  const myEntries = trpc.matchup.myContestEntries.useQuery(
    { limit: 20 },
    { enabled: isAuthenticated }
  );

  // Selected entry for analysis
  const [selectedLineupId, setSelectedLineupId] = useState<number | null>(null);
  const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
  const [selectedContestName, setSelectedContestName] = useState("");
  const [selectedEntryNumber, setSelectedEntryNumber] = useState<number>(1);

  // Fetch opponents for selected contest
  const opponents = trpc.matchup.contestOpponents.useQuery(
    { contestId: selectedContestId!, limit: 50 },
    { enabled: selectedContestId !== null }
  );

  // Analysis mutation
  const contestAnalyze = trpc.matchup.analyzeContestSwaps.useMutation({
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  // Manual analyze (for manual opponent input in contest mode)
  const manualAnalyze = trpc.matchup.analyzeSwaps.useMutation({
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  // Selected opponent
  const [selectedOpponent, setSelectedOpponent] = useState<{
    username: string;
    championIds: number[];
    championNames: string[];
  } | null>(null);

  const handleSelectEntry = (entry: {
    lineupId: number;
    contestId: number | null;
    contestName: string;
    entryNumber: number | null;
  }) => {
    setSelectedLineupId(entry.lineupId);
    setSelectedContestId(entry.contestId);
    setSelectedContestName(entry.contestName);
    setSelectedEntryNumber(entry.entryNumber ?? 1);
    setSelectedOpponent(null);
    contestAnalyze.reset();
    manualAnalyze.reset();
  };

  const handleSelectOpponent = (opp: {
    username: string;
    champions: Array<{ name: string; championTokenId: string }>;
  }) => {
    const champIds = opp.champions
      .map((c) => Number(c.championTokenId))
      .filter((id) => !isNaN(id));

    if (champIds.length !== 4) {
      toast.error("Opponent must have exactly 4 identified champions");
      return;
    }

    setSelectedOpponent({
      username: opp.username,
      championIds: champIds,
      championNames: opp.champions.map((c) => c.name),
    });

    // Auto-analyze immediately
    if (selectedLineupId) {
      contestAnalyze.mutate({
        lineupId: selectedLineupId,
        opponentChampionIds: champIds as [number, number, number, number],
      });
    }
  };

  // Get champion name from game data
  const getChampName = (tokenId: string | null) => {
    if (!tokenId || !gameData?.champions) return "?";
    const champ = gameData.champions.find((c) => String(c.tokenId) === tokenId);
    return champ?.name ?? `#${tokenId}`;
  };

  if (!isAuthenticated) {
    return (
      <Card className="border-gold/20 bg-gold/5">
        <CardContent className="p-6 text-center">
          <Users className="w-8 h-8 text-gold mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Login Required</p>
          <p className="text-xs text-muted-foreground">
            Sign in to auto-load your contest entries and get swap recommendations.
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedEntry = myEntries.data?.find(
    (e) => e.lineupId === selectedLineupId
  );

  return (
    <div className="space-y-4">
      {/* Step 1: Select Your Entry */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-emerald-400" />
            Step 1: Select Your Entry
          </CardTitle>
        </CardHeader>
        <CardContent>
          {myEntries.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading your entries...
            </div>
          ) : !myEntries.data || myEntries.data.length === 0 ? (
            <div className="text-center py-6">
              <Info className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No saved lineups found. Build a lineup in the{" "}
                <a href="/lineup-builder" className="text-teal hover:underline">
                  Lineup Builder
                </a>{" "}
                first.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {myEntries.data.map((entry) => {
                const isSelected = entry.lineupId === selectedLineupId;
                const champNames = [
                  getChampName(entry.champion1TokenId),
                  getChampName(entry.champion2TokenId),
                  getChampName(entry.champion3TokenId),
                  getChampName(entry.champion4TokenId),
                ];

                return (
                  <button
                    key={entry.lineupId}
                    onClick={() =>
                      handleSelectEntry({
                        lineupId: entry.lineupId,
                        contestId: entry.contestId,
                        contestName: entry.contestName,
                        entryNumber: entry.entryNumber,
                      })
                    }
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-border/30 bg-secondary/20 hover:bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold truncate max-w-[60%]">
                        {entry.contestName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-5 ${
                            entry.contestStatus === "LIVE"
                              ? "border-emerald-500/40 text-emerald-400"
                              : entry.contestStatus === "OPEN"
                                ? "border-gold/40 text-gold"
                                : "border-muted-foreground/30 text-muted-foreground"
                          }`}
                        >
                          {entry.contestStatus}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] h-5">
                          Entry #{entry.entryNumber}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Swords className="w-3 h-3" />
                      {entry.champions
                        ? entry.champions.map((c: any) => c.name).join(" · ")
                        : champNames.join(" · ")}
                    </div>
                    {entry.predictedScore && (
                      <div className="text-[10px] text-gold mt-1">
                        Predicted: {Number(entry.predictedScore).toLocaleString()} pts
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Opponent */}
      {selectedLineupId && selectedContestId && (
        <Card className="border-destructive/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-destructive" />
              Step 2: Select Opponent
              {selectedOpponent && (
                <Badge variant="outline" className="text-[10px] h-5 ml-auto">
                  vs {selectedOpponent.username}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {opponents.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading opponents...
              </div>
            ) : !opponents.data || opponents.data.opponents.length === 0 ? (
              <div className="text-center py-4">
                <AlertTriangle className="w-5 h-5 text-orange-400 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground mb-2">
                  No opponent data available yet for this contest. Run a contest scrape
                  from the Dashboard to populate leaderboard data, or enter opponents
                  manually below.
                </p>
                <ManualOpponentInput
                  gameData={gameData}
                  onAnalyze={(oppIds) => {
                    if (selectedLineupId) {
                      contestAnalyze.mutate({
                        lineupId: selectedLineupId,
                        opponentChampionIds: oppIds as [number, number, number, number],
                      });
                    }
                  }}
                  isPending={contestAnalyze.isPending}
                />
              </div>
            ) : (
              <div className="space-y-2 max-h-[350px] overflow-y-auto">
                {opponents.data.opponents.map((opp) => {
                  const isSelected =
                    selectedOpponent?.username === opp.username &&
                    selectedOpponent?.championIds.join(",") ===
                      opp.champions.map((c) => c.championTokenId).join(",");

                  return (
                    <button
                      key={opp.id}
                      onClick={() => handleSelectOpponent(opp)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? "border-destructive/50 bg-destructive/10"
                          : "border-border/30 bg-secondary/20 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">
                          {opp.username.length > 20
                            ? opp.username.slice(0, 8) + "..." + opp.username.slice(-4)
                            : opp.username}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] h-5">
                            Rank #{opp.rank}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {opp.score} pts
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Target className="w-3 h-3" />
                        {opp.champions.map((c) => c.name).join(" · ")}
                      </div>
                      {opp.aiConfidence !== null && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          AI confidence: {(opp.aiConfidence * 100).toFixed(0)}%
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {(contestAnalyze.isPending || manualAnalyze.isPending) && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin text-gold" />
          Analyzing matchups and finding optimal swaps...
        </div>
      )}

      {/* Results */}
      {contestAnalyze.data && (
        <AnalysisResults
          result={contestAnalyze.data}
          contestName={selectedContestName}
          entryNumber={selectedEntryNumber}
        />
      )}
    </div>
  );
}

// ─── Manual Opponent Input (fallback when no leaderboard data) ─────

function ManualOpponentInput({
  gameData,
  onAnalyze,
  isPending,
}: {
  gameData: GameData | undefined;
  onAnalyze: (oppIds: number[]) => void;
  isPending: boolean;
}) {
  const [oppSlots, setOppSlots] = useState<ChampionSlot[]>([
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
  ]);

  const updateOppSlot = (index: number, slot: ChampionSlot) => {
    setOppSlots((prev) => {
      const next = [...prev];
      next[index] = slot;
      return next;
    });
  };

  const allFilled = oppSlots.every((s) => s.tokenId !== null);

  return (
    <div className="space-y-3 mt-3 text-left">
      <p className="text-xs font-medium text-muted-foreground">
        Enter opponent MOKIs manually:
      </p>
      {oppSlots.map((slot, i) => (
        <ChampionPicker
          key={`manual-opp-${i}`}
          label="Opponent MOKI"
          position={i + 1}
          value={slot}
          onChange={(s) => updateOppSlot(i, s)}
          gameData={gameData}
        />
      ))}
      <Button
        onClick={() => onAnalyze(oppSlots.map((s) => s.tokenId!))}
        disabled={!allFilled || isPending}
        className="w-full bg-gold text-background hover:bg-gold/90 h-9 text-sm"
        size="sm"
      >
        {isPending ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            Analyzing...
          </>
        ) : (
          <>
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            Analyze Matchups
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Manual Mode Panel ─────────────────────────────────────────────

function ManualModePanel({
  gameData,
}: {
  gameData: GameData | undefined;
}) {
  const { isAuthenticated } = useAuth();

  const [yourSlots, setYourSlots] = useState<ChampionSlot[]>([
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
  ]);

  const [oppSlots, setOppSlots] = useState<ChampionSlot[]>([
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
  ]);

  const updateYourSlot = (index: number, slot: ChampionSlot) => {
    setYourSlots((prev) => {
      const next = [...prev];
      next[index] = slot;
      return next;
    });
  };

  const updateOppSlot = (index: number, slot: ChampionSlot) => {
    setOppSlots((prev) => {
      const next = [...prev];
      next[index] = slot;
      return next;
    });
  };

  const allYourFilled = yourSlots.every((s) => s.tokenId !== null);
  const allOppFilled = oppSlots.every((s) => s.tokenId !== null);
  const canAnalyze = allYourFilled && allOppFilled;

  const analyzeMutation = trpc.matchup.analyzeSwaps.useMutation({
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  const handleAnalyze = () => {
    if (!canAnalyze) return;
    analyzeMutation.mutate({
      yourChampionIds: yourSlots.map((s) => s.tokenId!),
      opponentChampionIds: oppSlots.map((s) => s.tokenId!),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              Your Lineup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {yourSlots.map((slot, i) => (
              <ChampionPicker
                key={`your-${i}`}
                label="Your MOKI"
                position={i + 1}
                value={slot}
                onChange={(s) => updateYourSlot(i, s)}
                gameData={gameData}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-destructive" />
              Opponent Lineup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {oppSlots.map((slot, i) => (
              <ChampionPicker
                key={`opp-${i}`}
                label="Opponent MOKI"
                position={i + 1}
                value={slot}
                onChange={(s) => updateOppSlot(i, s)}
                gameData={gameData}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleAnalyze}
          disabled={!canAnalyze || analyzeMutation.isPending}
          className="bg-gold text-background hover:bg-gold/90 px-8 h-11 text-sm font-semibold"
          size="lg"
        >
          {analyzeMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Analyzing Matchups...
            </>
          ) : (
            <>
              <Swords className="w-4 h-4 mr-2" />
              Analyze & Recommend Swaps
            </>
          )}
        </Button>
      </div>

      {analyzeMutation.data && <AnalysisResults result={analyzeMutation.data} />}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

export default function SwapAdvisor() {
  const { isAuthenticated } = useAuth();
  const [mode, setMode] = useState<AdvisorMode>(isAuthenticated ? "contest" : "manual");

  // Load game data for champion lookup
  const [gameData, setGameData] = useState<GameData | undefined>();
  useEffect(() => {
    fetch("/game-data.json")
      .then((r) => r.json())
      .then(setGameData)
      .catch(console.error);
  }, []);

  // Update mode when auth state changes
  useEffect(() => {
    if (isAuthenticated && mode === "manual") {
      // Don't auto-switch if user explicitly chose manual
    }
  }, [isAuthenticated]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">
            Swap Advisor
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Analyze your matchups and get swap recommendations based on H2H data
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2">
        <Button
          variant={mode === "contest" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("contest")}
          className={
            mode === "contest"
              ? "bg-gold text-background hover:bg-gold/90"
              : "bg-transparent"
          }
        >
          <ListChecks className="w-3.5 h-3.5 mr-1.5" />
          From Contest Entry
        </Button>
        <Button
          variant={mode === "manual" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("manual")}
          className={
            mode === "manual"
              ? "bg-gold text-background hover:bg-gold/90"
              : "bg-transparent"
          }
        >
          <PenLine className="w-3.5 h-3.5 mr-1.5" />
          Manual Input
        </Button>
      </div>

      {/* Info banner */}
      <Card className="border-teal/20 bg-teal/5">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-teal mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground">
              {mode === "contest" ? (
                <p>
                  Select a contest entry to auto-load your lineup, then pick an opponent
                  from the leaderboard. The advisor will analyze H2H win rates and suggest
                  optimal swaps from your bench.
                </p>
              ) : (
                <p>
                  Enter your 4 MOKIs and the opponent's 4 MOKIs in order (Match 1–4). The
                  advisor will analyze head-to-head win rates and suggest swaps from your
                  bench to improve your expected outcome.
                </p>
              )}
              {isAuthenticated && (
                <p className="mt-1 text-teal">
                  Logged in — your full card inventory will be used as the bench
                  automatically.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mode Content */}
      {mode === "contest" ? (
        <ContestModePanel gameData={gameData} />
      ) : (
        <ManualModePanel gameData={gameData} />
      )}
    </div>
  );
}
