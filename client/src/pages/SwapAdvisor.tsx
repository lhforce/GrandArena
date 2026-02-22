/**
 * Swap Advisor — Post-entry lineup optimization.
 *
 * After entering a contest, the user inputs their 4 MOKIs and the opponent's 4 MOKIs.
 * The engine analyzes H2H matchup data and recommends swaps from the user's bench
 * to improve win probability.
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
} from "lucide-react";
import { toast } from "sonner";
import type { GameData } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface ChampionSlot {
  tokenId: number | null;
  name: string;
}

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

  // Also search the match database for champions
  const dbSearch = trpc.matchup.searchChampions.useQuery(
    { query, limit: 10 },
    { enabled: query.length >= 2 }
  );

  // Combine game data + DB results for comprehensive search
  const results = useMemo(() => {
    const seen = new Set<number>();
    const combined: Array<{ tokenId: number; name: string; championClass: string; source: string }> = [];

    // DB results first (they have match data)
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

    // Game data fallback
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
        {/* Your champion */}
        <div className="flex-1 text-right">
          <p className="text-sm font-semibold truncate">{slot.yourChampionName}</p>
          <p className="text-[10px] text-muted-foreground">{slot.yourChampionClass}</p>
        </div>

        {/* VS indicator with win rate */}
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

        {/* Opponent */}
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
          {/* Current */}
          <div className="flex-1 p-2 rounded bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-sm font-semibold">{rec.currentChampionName}</p>
            <p className="text-xs text-destructive">
              {rec.currentWinRate.toFixed(1)}% WR
              {rec.currentH2hMatches > 0 && (
                <span className="text-muted-foreground"> · {rec.currentH2hMatches} matches</span>
              )}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 text-gold shrink-0" />

          {/* Suggested */}
          <div className="flex-1 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-xs text-muted-foreground">Swap In</p>
            <p className="text-sm font-semibold">{rec.suggestedChampionName}</p>
            <p className="text-xs text-emerald-400">
              {rec.suggestedWinRate.toFixed(1)}% WR
              {rec.suggestedH2hMatches > 0 && (
                <span className="text-muted-foreground"> · {rec.suggestedH2hMatches} matches</span>
              )}
            </p>
          </div>
        </div>

        {/* Improvement */}
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

// ─── Main Page ─────────────────────────────────────────────────────

export default function SwapAdvisor() {
  const { isAuthenticated } = useAuth();

  // Load game data for champion lookup
  const [gameData, setGameData] = useState<GameData | undefined>();
  useEffect(() => {
    fetch("/game-data.json")
      .then((r) => r.json())
      .then(setGameData)
      .catch(console.error);
  }, []);

  // Your lineup (4 slots)
  const [yourSlots, setYourSlots] = useState<ChampionSlot[]>([
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
    { tokenId: null, name: "" },
  ]);

  // Opponent lineup (4 slots)
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

  const result = analyzeMutation.data;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">
          Swap Advisor
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          Analyze your matchups and get swap recommendations based on H2H data
        </p>
      </div>

      {/* Info banner */}
      <Card className="border-teal/20 bg-teal/5">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-teal mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p>
                Enter your 4 MOKIs and the opponent's 4 MOKIs in order (Match 1–4).
                The advisor will analyze head-to-head win rates and suggest swaps from
                your bench to improve your expected outcome.
              </p>
              {isAuthenticated && (
                <p className="mt-1 text-teal">
                  Logged in — your full card inventory will be used as the bench automatically.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lineup Input */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Your Lineup */}
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

        {/* Opponent Lineup */}
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

      {/* Analyze Button */}
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

      {/* Results */}
      {result && (
        <div className="space-y-4 sm:space-y-6">
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
                    {result.dataQuality.matchupsWithoutData > 1 ? "s" : ""} have no H2H
                    data — using estimated win rates. Scrape more match history for better accuracy.
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
                  <Badge className="bg-gold/20 text-gold border-gold/30 ml-1" variant="outline">
                    {result.recommendations.length} swap{result.recommendations.length > 1 ? "s" : ""}
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
      )}
    </div>
  );
}
