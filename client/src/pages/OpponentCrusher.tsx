/**
 * Opponent Crusher — Counter-lineup builder.
 *
 * Enter an opponent's 4 champions, and the tool finds the best counter-lineup
 * from your owned cards based on real H2H match data.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  Swords,
  Shield,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Zap,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { GameData } from "@/lib/types";

// ─── Champion Search ───────────────────────────────────────────────

interface ChampionSlot {
  tokenId: number | null;
  name: string;
  image?: string;
}

function ChampionPicker({
  label,
  value,
  onChange,
  gameData,
  disabled,
}: {
  label: string;
  value: ChampionSlot;
  onChange: (slot: ChampionSlot) => void;
  gameData: GameData | undefined;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value.name);
  const [showResults, setShowResults] = useState(false);

  const dbSearch = trpc.matchup.searchChampions.useQuery(
    { query, limit: 8 },
    { enabled: query.length >= 2 }
  );

  const localResults = useMemo(() => {
    if (!gameData || query.length < 2) return [];
    const q = query.toLowerCase();
    return gameData.champions
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({
        tokenId: Number(c.championTokenId),
        name: c.name,
        championClass: (c.mokiAttributes?.Class?.[0] ?? ""),
        image: c.image,
      }));
  }, [gameData, query]);

  const results = useMemo(() => {
    const seen = new Set<number>();
    const combined: Array<{ tokenId: number; name: string; championClass: string; image?: string }> = [];
    for (const r of localResults) {
      if (!seen.has(r.tokenId)) { seen.add(r.tokenId); combined.push(r); }
    }
    for (const r of (dbSearch.data ?? [])) {
      const id = Number(r.championTokenId);
      if (!seen.has(id)) {
        seen.add(id);
        combined.push({ tokenId: id, name: r.championName, championClass: r.championClass ?? "", image: undefined });
      }
    }
    return combined.slice(0, 8);
  }, [localResults, dbSearch.data]);

  const handleSelect = (r: { tokenId: number; name: string; image?: string }) => {
    onChange({ tokenId: r.tokenId, name: r.name, image: r.image });
    setQuery(r.name);
    setShowResults(false);
  };

  const handleClear = () => {
    onChange({ tokenId: null, name: "" });
    setQuery("");
  };

  return (
    <div className="relative">
      <div className="text-xs text-muted-foreground mb-1 font-medium">{label}</div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          placeholder="Search champion..."
          className="pl-8 pr-8 h-9 text-sm"
          disabled={disabled}
        />
        {value.tokenId && (
          <button onClick={handleClear} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {results.map((r) => (
            <button
              key={r.tokenId}
              onMouseDown={() => handleSelect(r)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              {r.image && (
                <img src={r.image} alt={r.name} className="w-7 h-7 rounded object-cover flex-shrink-0" />
              )}
              <span className="font-medium">{r.name}</span>
              {r.championClass && (
                <span className="text-xs text-muted-foreground ml-auto">{r.championClass}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {value.tokenId && value.image && (
        <div className="mt-1.5 flex items-center gap-2 p-1.5 rounded-md bg-secondary/50 border border-border/50">
          <img src={value.image} alt={value.name} className="w-8 h-8 rounded object-cover" />
          <span className="text-sm font-medium text-foreground">{value.name}</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />
        </div>
      )}
    </div>
  );
}

// ─── Win Rate Badge ────────────────────────────────────────────────

function WinRateBadge({ rate, matches }: { rate: number; matches: number }) {
  const color = rate >= 60 ? "text-green-400" : rate >= 45 ? "text-yellow-400" : "text-red-400";
  const Icon = rate >= 55 ? TrendingUp : rate >= 45 ? Minus : TrendingDown;
  return (
    <div className={`flex items-center gap-1 ${color} font-mono text-sm font-bold`}>
      <Icon className="w-3.5 h-3.5" />
      {rate.toFixed(1)}%
      {matches > 0 && (
        <span className="text-xs text-muted-foreground font-normal ml-0.5">({matches})</span>
      )}
    </div>
  );
}

// ─── Counter Lineup Card ───────────────────────────────────────────

function CounterLineupCard({
  lineup,
  opponentChampions,
  rank,
}: {
  lineup: {
    rank: number;
    champions: Array<{
      championTokenId: number;
      championName: string;
      championClass: string;
      imageUrl?: string | null;
      avgWinRateVsOpponents: number;
      vsOpponents: Array<{
        opponentTokenId: number;
        opponentName: string;
        winRate: number;
        totalMatches: number;
        confidence: string;
      }>;
    }>;
    totalExpectedWinRate: number;
    avgWinRate: number;
    dataQuality: string;
  };
  opponentChampions: Array<{ tokenId: number; name: string; championClass: string }>;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(rank === 1);

  const qualityColor =
    lineup.dataQuality === "high"
      ? "text-green-400"
      : lineup.dataQuality === "medium"
      ? "text-yellow-400"
      : "text-red-400";

  const rankColors = ["border-gold/60 bg-gold/5", "border-border/60 bg-secondary/30", "border-border/40 bg-secondary/20"];
  const rankLabels = ["Best Counter", "2nd Option", "3rd Option"];

  return (
    <Card className={`border ${rankColors[rank - 1] ?? "border-border/40"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {rank === 1 && <Trophy className="w-4 h-4 text-gold" />}
            <CardTitle className="text-sm font-semibold">{rankLabels[rank - 1] ?? `Option ${rank}`}</CardTitle>
            <Badge variant="outline" className={`text-xs ${qualityColor} border-current`}>
              {lineup.dataQuality} data
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-foreground">{lineup.avgWinRate.toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">avg win rate</div>
            </div>
            <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Champion row */}
        <div className="flex gap-2 mt-2">
          {lineup.champions.map((c) => (
            <div key={c.championTokenId} className="flex-1 text-center">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.championName} className="w-full aspect-square rounded-lg object-cover border border-border/50" />
              ) : (
                <div className="w-full aspect-square rounded-lg bg-secondary/50 border border-border/50 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="text-[10px] font-medium mt-1 truncate">{c.championName}</div>
              <div className={`text-[10px] font-mono font-bold ${c.avgWinRateVsOpponents >= 55 ? "text-green-400" : c.avgWinRateVsOpponents >= 45 ? "text-yellow-400" : "text-red-400"}`}>
                {c.avgWinRateVsOpponents.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-3">
          <div className="border-t border-border/40 pt-3 mt-1">
            <div className="text-xs text-muted-foreground mb-2 font-medium">H2H Breakdown vs Each Opponent</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-1 pr-3 text-muted-foreground font-medium">Your Champion</th>
                    {opponentChampions.map((opp) => (
                      <th key={opp.tokenId} className="text-center py-1 px-2 text-muted-foreground font-medium min-w-[80px]">
                        vs {opp.name.split(" ").slice(-1)[0]}
                      </th>
                    ))}
                    <th className="text-center py-1 pl-2 text-muted-foreground font-medium">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {lineup.champions.map((c) => (
                    <tr key={c.championTokenId} className="border-b border-border/20 last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{c.championName}</td>
                      {c.vsOpponents.map((v) => (
                        <td key={v.opponentTokenId} className="py-1.5 px-2 text-center">
                          <WinRateBadge rate={v.winRate} matches={v.totalMatches} />
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 text-center">
                        <span className={`font-mono font-bold ${c.avgWinRateVsOpponents >= 55 ? "text-green-400" : c.avgWinRateVsOpponents >= 45 ? "text-yellow-400" : "text-red-400"}`}>
                          {c.avgWinRateVsOpponents.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

const EMPTY_SLOT: ChampionSlot = { tokenId: null, name: "" };

export default function OpponentCrusher() {
  const { user, isAuthenticated } = useAuth();
  const [opponentSlots, setOpponentSlots] = useState<ChampionSlot[]>([
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
  ]);

  // Load game data from public JSON
  const [localGameData, setLocalGameData] = useState<GameData | undefined>();
  useMemo(() => {
    fetch("/game-data.json")
      .then((r) => r.json())
      .then((d) => setLocalGameData(d))
      .catch(() => {});
  }, []);

  const buildCounter = trpc.matchup.buildCounterLineup.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const filledCount = opponentSlots.filter((s) => s.tokenId !== null).length;
  const canBuild = filledCount >= 1 && isAuthenticated;

  const handleBuild = () => {
    const ids = opponentSlots.filter((s) => s.tokenId !== null).map((s) => s.tokenId!);
    buildCounter.mutate({ opponentChampionIds: ids });
  };

  const updateSlot = (i: number, slot: ChampionSlot) => {
    setOpponentSlots((prev) => {
      const next = [...prev];
      next[i] = slot;
      return next;
    });
  };

  const result = buildCounter.data;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <Swords className="w-5 h-5 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Opponent Crusher</h1>
          <p className="text-sm text-muted-foreground">
            Enter your opponent's lineup to find the best counter from your owned cards
          </p>
        </div>
      </div>

      {!isAuthenticated && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4 pb-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-200">
              Sign in and sync your cards in <strong>My Cards</strong> to use Opponent Crusher. Your owned champions are needed to build counter-lineups.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Opponent Input */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-destructive" />
            Opponent's Champions
            <Badge variant="outline" className="text-xs ml-auto">
              {filledCount}/4 entered
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {opponentSlots.map((slot, i) => (
              <ChampionPicker
                key={i}
                label={`Opponent ${i + 1}`}
                value={slot}
                onChange={(s) => updateSlot(i, s)}
                gameData={localGameData}
                disabled={!isAuthenticated}
              />
            ))}
          </div>

          <Button
            onClick={handleBuild}
            disabled={!canBuild || buildCounter.isPending}
            className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {buildCounter.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing matchups...</>
            ) : (
              <><Zap className="w-4 h-4 mr-2" /> Find Counter Lineup</>
            )}
          </Button>

          {!isAuthenticated && (
            <p className="text-xs text-center text-muted-foreground">Sign in to use this feature</p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Opponent summary */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Countering:</span>
            {result.opponentChampions.map((opp) => (
              <Badge key={opp.tokenId} variant="secondary" className="text-xs">
                {opp.name}
              </Badge>
            ))}
          </div>

          {/* Data quality */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2">
            <span>Candidates analyzed: <strong className="text-foreground">{result.totalOwnedCandidates}</strong></span>
            <span>H2H pairs with data: <strong className="text-foreground">{result.dataQuality.pairsWithData}/{result.dataQuality.totalH2hPairs}</strong></span>
            <span>Coverage: <strong className="text-foreground">{result.dataQuality.coveragePct}%</strong></span>
          </div>

          {result.counterLineups.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="pt-6 pb-6 text-center">
                <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Not enough owned champions to build a counter lineup. Sync your cards in <strong>My Cards</strong> first.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {result.counterLineups.map((lineup) => (
                <CounterLineupCard
                  key={lineup.rank}
                  lineup={lineup}
                  opponentChampions={result.opponentChampions}
                  rank={lineup.rank}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
