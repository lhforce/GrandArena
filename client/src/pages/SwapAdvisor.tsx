/**
 * Swap Advisor — Post-entry lineup optimization.
 *
 * Grand Arena format: Each of your 4 MOKIs plays 5 individual 3v3 matches
 * against 5 different opponents = 20 total matches per round.
 *
 * Two modes:
 * 1. Contest Mode (auto): Pick a contest you've entered → auto-loads your lineup →
 *    enter each MOKI's 5 opponents → one-click swap analysis.
 * 2. Manual Mode: Enter 4 MOKIs + 5 opponents each by hand.
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
  ChevronDown,
  ChevronUp,
  Sparkles,
  Info,
  Trophy,
  Users,
  Zap,
  ListChecks,
  PenLine,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { GameData } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface ChampionSlot {
  tokenId: number | null;
  name: string;
}

/** A MOKI slot with its 5 opponents */
interface MokiSlotInput {
  champion: ChampionSlot;
  opponents: ChampionSlot[];
}

type AdvisorMode = "contest" | "manual";

// ─── Champion Search (reusable autocomplete from game data) ────────

function ChampionPicker({
  label,
  value,
  onChange,
  gameData,
  compact = false,
}: {
  label: string;
  value: ChampionSlot;
  onChange: (slot: ChampionSlot) => void;
  gameData: GameData | undefined;
  compact?: boolean;
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
        if (!isNaN(tid) && !seen.has(tid)) {
          if (c.name?.toLowerCase().includes(q)) {
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
    }

    return combined.slice(0, 8);
  }, [dbSearch.data, gameData, query]);

  useEffect(() => {
    setQuery(value.name);
  }, [value.name]);

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        {!compact && (
          <span className="text-[10px] text-muted-foreground w-16 shrink-0">
            {label}
          </span>
        )}
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(true);
              if (!e.target.value) {
                onChange({ tokenId: null, name: "" });
              }
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="Search MOKI..."
            className={`pl-7 ${compact ? "h-7 text-xs" : "h-8 text-xs"}`}
          />
          {value.tokenId !== null && (
            <button
              onClick={() => {
                onChange({ tokenId: null, name: "" });
                setQuery("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      {showResults && results.length > 0 && !value.tokenId && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.tokenId}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange({ tokenId: c.tokenId, name: c.name });
                setQuery(c.name);
                setShowResults(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-accent/50 flex items-center gap-2"
            >
              <span className="text-xs font-medium flex-1 truncate">
                {c.name}
              </span>
              <span className="flex items-center gap-1">
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

// ─── Single Matchup Display (1 of 5 opponents for a MOKI) ─────────

function SingleMatchupRow({
  matchup,
}: {
  matchup: {
    opponentChampionName: string;
    opponentChampionClass: string;
    h2hWinRate: number;
    h2hMatches: number;
    h2hWins: number;
    h2hLosses: number;
    confidence: string;
  };
}) {
  const wr = matchup.h2hWinRate;
  const isGood = wr >= 55;
  const isBad = wr < 45;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded text-xs">
      <span className="flex-1 truncate font-medium">
        {matchup.opponentChampionName}
      </span>
      <Badge variant="outline" className="text-[9px] h-4 px-1">
        {matchup.opponentChampionClass}
      </Badge>
      <span
        className={`w-14 text-right font-bold tabular-nums ${
          isGood ? "text-emerald-400" : isBad ? "text-destructive" : "text-foreground"
        }`}
      >
        {wr.toFixed(1)}%
      </span>
      <span className="w-12 text-right text-[10px] text-muted-foreground tabular-nums">
        {matchup.h2hMatches > 0
          ? `${matchup.h2hWins}W-${matchup.h2hLosses}L`
          : "est."}
      </span>
    </div>
  );
}

// ─── MOKI Slot Card (shows 1 MOKI with its 5 opponents) ──────────

function MokiSlotCard({
  slot,
}: {
  slot: {
    slotIndex: number;
    yourChampionName: string;
    yourChampionClass: string;
    averageWinRate: number;
    expectedWins: number;
    opponents: Array<{
      opponentChampionName: string;
      opponentChampionClass: string;
      h2hWinRate: number;
      h2hMatches: number;
      h2hWins: number;
      h2hLosses: number;
      confidence: string;
    }>;
  };
}) {
  const [expanded, setExpanded] = useState(true);
  const avgWr = slot.averageWinRate;
  const isGood = avgWr >= 55;
  const isBad = avgWr < 45;

  return (
    <Card
      className={`border transition-all ${
        isGood
          ? "border-emerald-500/30"
          : isBad
            ? "border-destructive/30"
            : "border-border/50"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{slot.yourChampionName}</span>
            <Badge variant="outline" className="text-[10px] h-5">
              {slot.yourChampionClass}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span>Slot {slot.slotIndex + 1}</span>
            <span>·</span>
            <span>{slot.opponents.length} opponents</span>
          </div>
        </div>
        <div className="text-right mr-2">
          <div
            className={`text-lg font-bold tabular-nums ${
              isGood ? "text-emerald-400" : isBad ? "text-destructive" : "text-foreground"
            }`}
          >
            {avgWr.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            ~{slot.expectedWins.toFixed(1)} wins / {slot.opponents.length}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-3">
          <div className="divide-y divide-border/30">
            {slot.opponents.map((opp, i) => (
              <SingleMatchupRow key={i} matchup={opp} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Swap Recommendation Card (now shows per-opponent breakdown) ──

function SwapCard({
  rec,
}: {
  rec: {
    slotIndex: number;
    currentChampionName: string;
    currentAvgWinRate: number;
    currentExpectedWins: number;
    suggestedChampionName: string;
    suggestedChampionClass: string;
    suggestedAvgWinRate: number;
    suggestedExpectedWins: number;
    winRateImprovement: number;
    expectedWinsImprovement: number;
    opponentBreakdown: Array<{
      opponentName: string;
      currentWinRate: number;
      suggestedWinRate: number;
      improvement: number;
    }>;
    reason: string;
    confidence: string;
  };
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <Card className="border-gold/30 bg-gold/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-gold" />
            <span className="text-sm font-semibold">
              Slot {rec.slotIndex + 1} Swap
            </span>
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
              {rec.currentAvgWinRate.toFixed(1)}% avg WR ·{" "}
              ~{rec.currentExpectedWins.toFixed(1)} wins
            </p>
          </div>

          <ChevronRight className="w-5 h-5 text-gold shrink-0" />

          <div className="flex-1 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-xs text-muted-foreground">Swap In</p>
            <p className="text-sm font-semibold">{rec.suggestedChampionName}</p>
            <p className="text-xs text-emerald-400">
              {rec.suggestedAvgWinRate.toFixed(1)}% avg WR ·{" "}
              ~{rec.suggestedExpectedWins.toFixed(1)} wins
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm font-bold text-emerald-400">
            +{rec.winRateImprovement.toFixed(1)}% avg win rate ·{" "}
            +{rec.expectedWinsImprovement.toFixed(2)} expected wins
          </span>
        </div>

        <p className="text-xs text-muted-foreground mb-2">{rec.reason}</p>

        {/* Per-opponent breakdown toggle */}
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="flex items-center gap-1 text-[11px] text-teal hover:text-teal/80"
        >
          {showBreakdown ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          {showBreakdown ? "Hide" : "Show"} per-opponent breakdown
        </button>

        {showBreakdown && (
          <div className="mt-2 space-y-1">
            {rec.opponentBreakdown.map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[11px] py-1 px-2 rounded bg-secondary/20"
              >
                <span className="flex-1 truncate">{b.opponentName}</span>
                <span className="text-muted-foreground tabular-nums">
                  {b.currentWinRate.toFixed(1)}%
                </span>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <span
                  className={`tabular-nums font-medium ${
                    b.improvement > 0
                      ? "text-emerald-400"
                      : b.improvement < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {b.suggestedWinRate.toFixed(1)}%
                </span>
                <span
                  className={`text-[10px] tabular-nums ${
                    b.improvement > 0
                      ? "text-emerald-400"
                      : b.improvement < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  ({b.improvement > 0 ? "+" : ""}
                  {b.improvement.toFixed(1)})
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Analysis Results Display (4×5 format) ────────────────────────

function AnalysisResults({
  result,
  contestName,
  entryNumber,
}: {
  result: {
    slots: Array<{
      slotIndex: number;
      yourChampionName: string;
      yourChampionClass: string;
      averageWinRate: number;
      expectedWins: number;
      opponents: Array<{
        opponentChampionName: string;
        opponentChampionClass: string;
        h2hWinRate: number;
        h2hMatches: number;
        h2hWins: number;
        h2hLosses: number;
        confidence: string;
      }>;
    }>;
    currentOverallWinRate: number;
    currentExpectedTotalWins: number;
    recommendations: Array<{
      slotIndex: number;
      currentChampionName: string;
      currentAvgWinRate: number;
      currentExpectedWins: number;
      suggestedChampionName: string;
      suggestedChampionClass: string;
      suggestedAvgWinRate: number;
      suggestedExpectedWins: number;
      winRateImprovement: number;
      expectedWinsImprovement: number;
      opponentBreakdown: Array<{
        opponentName: string;
        currentWinRate: number;
        suggestedWinRate: number;
        improvement: number;
      }>;
      reason: string;
      confidence: string;
    }>;
    bestPossibleWinRate: number;
    bestPossibleExpectedWins: number;
    improvementPotential: number;
    dataQuality: {
      matchupsWithData: number;
      matchupsWithoutData: number;
      totalH2hMatchesUsed: number;
      totalMatchups: number;
    };
  };
  contestName?: string;
  entryNumber?: number;
}) {
  const totalMatchups = result.dataQuality.totalMatchups;

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
            <Badge variant="outline" className="text-[10px] h-5 ml-auto">
              {totalMatchups} matchups
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
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
              <p className="text-[10px] text-muted-foreground mb-1">Expected Wins</p>
              <p className="text-xl font-bold tabular-nums">
                {result.currentExpectedTotalWins.toFixed(1)}
                <span className="text-sm text-muted-foreground">/{totalMatchups}</span>
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
                {result.dataQuality.matchupsWithData}/{totalMatchups}
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
                {result.dataQuality.matchupsWithoutData} of {totalMatchups} matchups
                have no H2H data — using estimated win rates. Scrape more match history
                for better accuracy.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MOKI Slots (4 cards, each with 5 opponents) */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Swords className="w-4 h-4 text-teal" />
            Your Matchups (4 MOKIs × {result.slots[0]?.opponents.length ?? 5} opponents)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {result.slots.map((slot) => (
              <MokiSlotCard key={slot.slotIndex} slot={slot} />
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
                No swaps found that would improve your expected win rate by more than 2%
                across all 5 opponents.
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

// ─── MOKI Slot Input (1 MOKI + 5 opponents) ─────────────────────

function MokiSlotInputCard({
  slotIndex,
  slot,
  onUpdateChampion,
  onUpdateOpponent,
  onAddOpponent,
  onRemoveOpponent,
  gameData,
}: {
  slotIndex: number;
  slot: MokiSlotInput;
  onUpdateChampion: (champ: ChampionSlot) => void;
  onUpdateOpponent: (oppIdx: number, opp: ChampionSlot) => void;
  onAddOpponent: () => void;
  onRemoveOpponent: (oppIdx: number) => void;
  gameData: GameData | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const filledOpps = slot.opponents.filter((o) => o.tokenId !== null).length;

  return (
    <Card className="border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-xs font-bold">
          {slotIndex + 1}
        </div>
        <div className="flex-1">
          <span className="text-sm font-semibold">
            {slot.champion.name || `MOKI Slot ${slotIndex + 1}`}
          </span>
          <span className="text-[11px] text-muted-foreground ml-2">
            {filledOpps}/{slot.opponents.length} opponents
          </span>
        </div>
        {slot.champion.tokenId && filledOpps === slot.opponents.length ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <Minus className="w-4 h-4 text-muted-foreground" />
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-3 space-y-2">
          {/* Your MOKI */}
          <div className="pb-2 border-b border-border/30">
            <p className="text-[10px] text-emerald-400 font-medium mb-1 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Your MOKI
            </p>
            <ChampionPicker
              label=""
              value={slot.champion}
              onChange={onUpdateChampion}
              gameData={gameData}
              compact
            />
          </div>

          {/* Opponents */}
          <div>
            <p className="text-[10px] text-destructive font-medium mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" /> Opponents ({slot.opponents.length})
            </p>
            <div className="space-y-1.5">
              {slot.opponents.map((opp, oppIdx) => (
                <div key={oppIdx} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground w-4 text-center">
                    {oppIdx + 1}
                  </span>
                  <div className="flex-1">
                    <ChampionPicker
                      label=""
                      value={opp}
                      onChange={(s) => onUpdateOpponent(oppIdx, s)}
                      gameData={gameData}
                      compact
                    />
                  </div>
                  {slot.opponents.length > 1 && (
                    <button
                      onClick={() => onRemoveOpponent(oppIdx)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {slot.opponents.length < 10 && (
              <button
                onClick={onAddOpponent}
                className="flex items-center gap-1 text-[11px] text-teal hover:text-teal/80 mt-1.5 ml-5"
              >
                <Plus className="w-3 h-3" /> Add opponent
              </button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Contest Mode Panel ───────────────────────────────────────────

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

  // Selected entry
  const [selectedLineupId, setSelectedLineupId] = useState<number | null>(null);
  const [selectedContestName, setSelectedContestName] = useState("");
  const [selectedEntryNumber, setSelectedEntryNumber] = useState<number>(1);

  // 4 MOKI slots with opponents (populated from entry + manual opponent input)
  const [slots, setSlots] = useState<MokiSlotInput[]>([]);

  // Analysis mutation
  const analyzeMutation = trpc.matchup.analyzeSwaps.useMutation({
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  const handleSelectEntry = (entry: {
    lineupId: number;
    contestName: string;
    entryNumber: number | null;
    champions?: Array<{ name: string; championTokenId: number }>;
    champion1TokenId: string | null;
    champion2TokenId: string | null;
    champion3TokenId: string | null;
    champion4TokenId: string | null;
  }) => {
    setSelectedLineupId(entry.lineupId);
    setSelectedContestName(entry.contestName);
    setSelectedEntryNumber(entry.entryNumber ?? 1);
    analyzeMutation.reset();

    // Build slots from the entry's champions
    const champTokenIds = entry.champions
      ? entry.champions.map((c) => ({
          tokenId: c.championTokenId,
          name: c.name,
        }))
      : [
          entry.champion1TokenId,
          entry.champion2TokenId,
          entry.champion3TokenId,
          entry.champion4TokenId,
        ]
          .filter(Boolean)
          .map((tid) => {
            const champ = gameData?.champions?.find(
              (c) => String(c.tokenId) === tid
            );
            return {
              tokenId: Number(tid),
              name: champ?.name ?? `#${tid}`,
            };
          });

    setSlots(
      champTokenIds.map((c) => ({
        champion: { tokenId: c.tokenId, name: c.name },
        opponents: Array.from({ length: 5 }, () => ({
          tokenId: null,
          name: "",
        })),
      }))
    );
  };

  const updateSlotChampion = (slotIdx: number, champ: ChampionSlot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { ...next[slotIdx], champion: champ };
      return next;
    });
  };

  const updateSlotOpponent = (
    slotIdx: number,
    oppIdx: number,
    opp: ChampionSlot
  ) => {
    setSlots((prev) => {
      const next = [...prev];
      const opponents = [...next[slotIdx].opponents];
      opponents[oppIdx] = opp;
      next[slotIdx] = { ...next[slotIdx], opponents };
      return next;
    });
  };

  const addSlotOpponent = (slotIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = {
        ...next[slotIdx],
        opponents: [
          ...next[slotIdx].opponents,
          { tokenId: null, name: "" },
        ],
      };
      return next;
    });
  };

  const removeSlotOpponent = (slotIdx: number, oppIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const opponents = next[slotIdx].opponents.filter((_, i) => i !== oppIdx);
      next[slotIdx] = { ...next[slotIdx], opponents };
      return next;
    });
  };

  const canAnalyze = slots.every(
    (s) =>
      s.champion.tokenId !== null &&
      s.opponents.some((o) => o.tokenId !== null)
  );

  const handleAnalyze = () => {
    if (!canAnalyze) return;
    analyzeMutation.mutate({
      slots: slots.map((s) => ({
        championTokenId: s.champion.tokenId!,
        opponents: s.opponents
          .filter((o) => o.tokenId !== null)
          .map((o) => o.tokenId!),
      })),
    });
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
                    onClick={() => handleSelectEntry(entry as any)}
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

      {/* Step 2: Enter Opponents for Each MOKI */}
      {slots.length > 0 && (
        <Card className="border-destructive/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-destructive" />
              Step 2: Enter Opponents for Each MOKI
              <span className="text-[11px] text-muted-foreground font-normal ml-auto">
                Each MOKI plays 5 opponents
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {slots.map((slot, slotIdx) => (
                <MokiSlotInputCard
                  key={slotIdx}
                  slotIndex={slotIdx}
                  slot={slot}
                  onUpdateChampion={(c) => updateSlotChampion(slotIdx, c)}
                  onUpdateOpponent={(oppIdx, opp) =>
                    updateSlotOpponent(slotIdx, oppIdx, opp)
                  }
                  onAddOpponent={() => addSlotOpponent(slotIdx)}
                  onRemoveOpponent={(oppIdx) =>
                    removeSlotOpponent(slotIdx, oppIdx)
                  }
                  gameData={gameData}
                />
              ))}
            </div>

            <div className="flex justify-center mt-4">
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze || analyzeMutation.isPending}
                className="bg-gold text-background hover:bg-gold/90 px-8 h-11 text-sm font-semibold"
                size="lg"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Analyzing 20 Matchups...
                  </>
                ) : (
                  <>
                    <Swords className="w-4 h-4 mr-2" />
                    Analyze & Recommend Swaps
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {analyzeMutation.isPending && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin text-gold" />
          Analyzing {slots.reduce((sum, s) => sum + s.opponents.filter(o => o.tokenId).length, 0)} matchups and finding optimal swaps...
        </div>
      )}

      {/* Results */}
      {analyzeMutation.data && (
        <AnalysisResults
          result={analyzeMutation.data}
          contestName={selectedContestName}
          entryNumber={selectedEntryNumber}
        />
      )}
    </div>
  );
}

// ─── Manual Mode Panel (4 MOKIs × 5 opponents each) ──────────────

function ManualModePanel({
  gameData,
}: {
  gameData: GameData | undefined;
}) {
  const { isAuthenticated } = useAuth();

  const [slots, setSlots] = useState<MokiSlotInput[]>(
    Array.from({ length: 4 }, () => ({
      champion: { tokenId: null, name: "" },
      opponents: Array.from({ length: 5 }, () => ({
        tokenId: null,
        name: "",
      })),
    }))
  );

  const updateSlotChampion = (slotIdx: number, champ: ChampionSlot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { ...next[slotIdx], champion: champ };
      return next;
    });
  };

  const updateSlotOpponent = (
    slotIdx: number,
    oppIdx: number,
    opp: ChampionSlot
  ) => {
    setSlots((prev) => {
      const next = [...prev];
      const opponents = [...next[slotIdx].opponents];
      opponents[oppIdx] = opp;
      next[slotIdx] = { ...next[slotIdx], opponents };
      return next;
    });
  };

  const addSlotOpponent = (slotIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = {
        ...next[slotIdx],
        opponents: [
          ...next[slotIdx].opponents,
          { tokenId: null, name: "" },
        ],
      };
      return next;
    });
  };

  const removeSlotOpponent = (slotIdx: number, oppIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const opponents = next[slotIdx].opponents.filter((_, i) => i !== oppIdx);
      next[slotIdx] = { ...next[slotIdx], opponents };
      return next;
    });
  };

  const canAnalyze = slots.every(
    (s) =>
      s.champion.tokenId !== null &&
      s.opponents.some((o) => o.tokenId !== null)
  );

  const analyzeMutation = trpc.matchup.analyzeSwaps.useMutation({
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  const handleAnalyze = () => {
    if (!canAnalyze) return;
    analyzeMutation.mutate({
      slots: slots.map((s) => ({
        championTokenId: s.champion.tokenId!,
        opponents: s.opponents
          .filter((o) => o.tokenId !== null)
          .map((o) => o.tokenId!),
      })),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {slots.map((slot, slotIdx) => (
          <MokiSlotInputCard
            key={slotIdx}
            slotIndex={slotIdx}
            slot={slot}
            onUpdateChampion={(c) => updateSlotChampion(slotIdx, c)}
            onUpdateOpponent={(oppIdx, opp) =>
              updateSlotOpponent(slotIdx, oppIdx, opp)
            }
            onAddOpponent={() => addSlotOpponent(slotIdx)}
            onRemoveOpponent={(oppIdx) =>
              removeSlotOpponent(slotIdx, oppIdx)
            }
            gameData={gameData}
          />
        ))}
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
  const [mode, setMode] = useState<AdvisorMode>(
    isAuthenticated ? "contest" : "manual"
  );

  // Load game data for champion lookup
  const [gameData, setGameData] = useState<GameData | undefined>();
  useEffect(() => {
    fetch("/game-data.json")
      .then((r) => r.json())
      .then(setGameData)
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">
            Swap Advisor
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Analyze your 20 matchups (4 MOKIs × 5 opponents) and get swap
            recommendations based on H2H data
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
                  Select a contest entry to auto-load your 4 MOKIs, then enter
                  each MOKI's 5 opponents. The advisor will analyze all 20
                  matchups and suggest optimal swaps from your bench.
                </p>
              ) : (
                <p>
                  Enter your 4 MOKIs and each one's 5 opponents. The advisor
                  will analyze all 20 head-to-head matchups and suggest swaps
                  from your bench to improve your expected outcome.
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
