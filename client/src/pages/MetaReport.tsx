/**
 * Meta Report — Top performing champions ranked by real match data,
 * with Ronin Marketplace floor prices for each rarity tier.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  ShoppingCart,
  Shield,
  Zap,
  RefreshCw,
  Star,
  Swords,
  Target,
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ───────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
  Basic: "text-gray-400",
  Rare: "text-blue-400",
  Epic: "text-purple-400",
  Legendary: "text-gold",
};

const RARITY_BG: Record<string, string> = {
  Basic: "bg-gray-500/10 border-gray-500/30",
  Rare: "bg-blue-500/10 border-blue-500/30",
  Epic: "bg-purple-500/10 border-purple-500/30",
  Legendary: "bg-gold/10 border-gold/30",
};

function WinRateBar({ rate }: { rate: number }) {
  const color = rate >= 55 ? "bg-green-500" : rate >= 45 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-10 text-right ${rate >= 55 ? "text-green-400" : rate >= 45 ? "text-yellow-400" : "text-red-400"}`}>
        {rate.toFixed(1)}%
      </span>
    </div>
  );
}

function PriceTag({ price, rarity }: { price: number | null; rarity: string }) {
  if (price === null) return <span className="text-xs text-muted-foreground/50">—</span>;
  return (
    <span className={`text-xs font-mono font-semibold ${RARITY_COLORS[rarity] ?? "text-foreground"}`}>
      {price.toFixed(1)}
    </span>
  );
}

// ─── Champion Row ──────────────────────────────────────────────────

function ChampionRow({
  champion,
  rank,
}: {
  champion: {
    championTokenId: number;
    championName: string;
    championClass: string;
    imageUrl?: string | null;
    totalMatches: number;
    winRate: number;
    avgScore: number;
    avgKills: number;
    avgBalls: number;
    avgWartDistance: number;
    prices: { Basic: number | null; Rare: number | null; Epic: number | null; Legendary: number | null };
    cheapestEntry: { rarity: string; price: number } | null;
  };
  rank: number;
}) {
  const rankColor = rank === 1 ? "text-gold" : rank === 2 ? "text-gray-300" : rank === 3 ? "text-amber-600" : "text-muted-foreground";

  return (
    <tr className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
      {/* Rank */}
      <td className="py-2.5 pl-3 pr-2 w-8">
        <span className={`text-sm font-bold font-mono ${rankColor}`}>#{rank}</span>
      </td>
      {/* Champion */}
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          {champion.imageUrl ? (
            <img src={champion.imageUrl} alt={champion.championName} className="w-8 h-8 rounded-md object-cover flex-shrink-0 border border-border/50" />
          ) : (
            <div className="w-8 h-8 rounded-md bg-secondary/50 border border-border/50 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <div>
            <div className="text-sm font-semibold leading-tight">{champion.championName}</div>
            <div className="text-[11px] text-muted-foreground">{champion.championClass}</div>
          </div>
        </div>
      </td>
      {/* Win Rate */}
      <td className="py-2.5 pr-4 min-w-[120px]">
        <WinRateBar rate={champion.winRate} />
        <div className="text-[10px] text-muted-foreground mt-0.5">{champion.totalMatches} matches</div>
      </td>
      {/* Avg Score */}
      <td className="py-2.5 pr-4 text-center">
        <span className="text-sm font-mono font-semibold text-teal">{champion.avgScore > 0 ? champion.avgScore.toFixed(0) : "—"}</span>
      </td>
      {/* Stats */}
      <td className="py-2.5 pr-4 hidden md:table-cell">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span><Swords className="w-3 h-3 inline mr-0.5 text-red-400" />{champion.avgKills.toFixed(1)}</span>
          <span><Target className="w-3 h-3 inline mr-0.5 text-blue-400" />{champion.avgBalls.toFixed(1)}</span>
        </div>
      </td>
      {/* Prices */}
      <td className="py-2.5 pr-3 hidden lg:table-cell">
        <div className="flex gap-2 items-center flex-wrap">
          {(["Basic", "Rare", "Epic", "Legendary"] as const).map((r) => (
            <div key={r} className={`px-1.5 py-0.5 rounded border text-center min-w-[36px] ${RARITY_BG[r]}`}>
              <div className="text-[9px] text-muted-foreground">{r[0]}</div>
              <PriceTag price={champion.prices[r]} rarity={r} />
            </div>
          ))}
        </div>
      </td>
      {/* Cheapest */}
      <td className="py-2.5 pr-3 text-right">
        {champion.cheapestEntry ? (
          <div className="text-right">
            <div className={`text-sm font-mono font-bold ${RARITY_COLORS[champion.cheapestEntry.rarity] ?? "text-foreground"}`}>
              {champion.cheapestEntry.price.toFixed(1)} RON
            </div>
            <div className="text-[10px] text-muted-foreground">{champion.cheapestEntry.rarity}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No listing</span>
        )}
      </td>
    </tr>
  );
}

// ─── Class Summary Card ────────────────────────────────────────────

function ClassCard({ cls }: {
  cls: { championClass: string; totalChampions: number; avgWinRate: number; avgScore: number; topChampion: string };
}) {
  return (
    <Card className="border-border/40">
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold">{cls.championClass}</span>
          <Badge variant="outline" className="text-[10px]">{cls.totalChampions} champs</Badge>
        </div>
        <WinRateBar rate={cls.avgWinRate} />
        <div className="text-[10px] text-muted-foreground mt-1">
          Avg score: <span className="text-teal font-mono">{cls.avgScore.toFixed(0)}</span> · Top: <span className="text-foreground">{cls.topChampion}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

type SortBy = "winRate" | "avgScore" | "avgKills" | "avgBalls" | "totalMatches";

export default function MetaReport() {
  const [sortBy, setSortBy] = useState<SortBy>("winRate");
  const [limit, setLimit] = useState(25);
  const [minMatches, setMinMatches] = useState(10);
  const [fetchKey, setFetchKey] = useState(0);

  const report = trpc.matchup.getMetaReport.useQuery(
    { sortBy, limit, minMatches, includePrices: true },
    {
      staleTime: 1000 * 60 * 10, // Cache for 10 minutes (prices are slow to fetch)
      retry: 1,
    }
  );

  const handleRefresh = () => {
    setFetchKey((k) => k + 1);
    report.refetch();
    toast.info("Refreshing meta report with latest prices...");
  };

  const data = report.data;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal/10 border border-teal/20">
            <BarChart3 className="w-5 h-5 text-teal" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Meta Report</h1>
            <p className="text-sm text-muted-foreground">
              Top champions by real match performance + Ronin Marketplace prices
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={report.isFetching} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${report.isFetching ? "animate-spin" : ""}`} />
          {report.isFetching ? "Loading..." : "Refresh Prices"}
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by:</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="winRate">Win Rate</SelectItem>
              <SelectItem value="avgScore">Avg Score</SelectItem>
              <SelectItem value="avgKills">Avg Kills</SelectItem>
              <SelectItem value="avgBalls">Avg Balls</SelectItem>
              <SelectItem value="totalMatches">Most Matches</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Show top:</span>
          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Min matches:</span>
          <Select value={String(minMatches)} onValueChange={(v) => setMinMatches(Number(v))}>
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {data && (
          <span className="text-xs text-muted-foreground ml-auto">
            {data.totalChampionsWithData} champions with data · Updated {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Loading state */}
      {report.isLoading && (
        <Card className="border-border/50">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-teal" />
            <p className="text-sm text-muted-foreground">Loading meta report and fetching marketplace prices...</p>
            <p className="text-xs text-muted-foreground">This may take 20-30 seconds on first load</p>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {report.error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-destructive">{report.error.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Class Summary */}
      {data && data.classSummary.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Class Performance</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {data.classSummary.map((cls) => (
              <ClassCard key={cls.championClass} cls={cls} />
            ))}
          </div>
        </div>
      )}

      {/* Champions Table */}
      {data && data.champions.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-gold" />
              Top {data.champions.length} Champions
              <span className="text-xs text-muted-foreground font-normal ml-1">sorted by {sortBy}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/40 bg-secondary/30">
                    <th className="text-left py-2 pl-3 pr-2 text-xs text-muted-foreground font-medium w-8">#</th>
                    <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Champion</th>
                    <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium min-w-[120px]">Win Rate</th>
                    <th className="text-center py-2 pr-4 text-xs text-muted-foreground font-medium">Avg Score</th>
                    <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium hidden md:table-cell">Stats</th>
                    <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium hidden lg:table-cell">
                      <div className="flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> Prices (RON)</div>
                    </th>
                    <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Cheapest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.champions.map((c, i) => (
                    <ChampionRow key={c.championTokenId} champion={c} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.champions.length === 0 && !report.isLoading && (
        <Card className="border-border/50">
          <CardContent className="pt-8 pb-8 text-center">
            <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No champion data found with {minMatches}+ matches.</p>
            <p className="text-xs text-muted-foreground mt-1">Try reducing the minimum matches filter.</p>
          </CardContent>
        </Card>
      )}

      {/* Price legend */}
      {data && data.champions.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>Price legend (RON):</span>
          {(["Basic", "Rare", "Epic", "Legendary"] as const).map((r) => (
            <span key={r} className={RARITY_COLORS[r]}>{r[0]} = {r}</span>
          ))}
          <span className="ml-auto">Prices from Ronin Marketplace · {data && new Date(data.generatedAt).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
