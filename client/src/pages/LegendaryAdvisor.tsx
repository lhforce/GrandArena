/**
 * Legendary Card Acquisition Advisor
 *
 * Ranks top MOKIs for a selected scheme by avg score → win rate,
 * checks Legendary ownership, shows marketplace prices and crafting costs,
 * and highlights the cheapest acquisition path.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Crown,
  Gem,
  ShoppingCart,
  Hammer,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingUp,
  Swords,
  ExternalLink,
  Info,
  Star,
  Sparkles,
} from "lucide-react";
import { getLoginUrl } from "@/const";

// ─── Scheme list (matches game-data.json) ───────────────────────────
const SCHEMES = [
  "Aggressive Specialization",
  "Baiting the Trap",
  "Beat the Buzzer",
  "Big Game Hunt",
  "Cage Match",
  "Call to Arms",
  "Collect 'Em All",
  "Collective Specialization",
  "Costume Party",
  "Cursed Dinner",
  "Divine Intervention",
  "Dress to Impress",
  "Dungaree Duel",
  "Enforcing the Naughty List",
  "Final Blow",
  "Flexing",
  "Gacha Gouging",
  "Gacha Hoarding",
  "Golden Shower",
  "Grabbing Balls",
  "Housekeeping",
  "Litter Collection",
  "Malicious Intent",
  "Midnight Strike",
  "Moki Smash",
  "Rainbow Riot",
  "Running Interference",
  "Saccing",
  "Shapeshifting",
  "Taking a Dive",
  "Tear Jerking",
  "Touching the Wart",
  "Victory Lap",
  "Wart Rodeo",
  "Whale Watching",
];

// ─── Rarity styling ─────────────────────────────────────────────────
const RARITY_COLORS: Record<string, string> = {
  Basic: "text-rarity-basic",
  Rare: "text-rarity-rare",
  Epic: "text-rarity-epic",
  Legendary: "text-rarity-legendary",
};
const RARITY_BG: Record<string, string> = {
  Basic: "bg-rarity-basic/20 border-rarity-basic/40",
  Rare: "bg-rarity-rare/20 border-rarity-rare/40",
  Epic: "bg-rarity-epic/20 border-rarity-epic/40",
  Legendary: "bg-rarity-legendary/20 border-rarity-legendary/40",
};

// ─── Helpers ────────────────────────────────────────────────────────
function formatRON(ron: number | null | undefined): string {
  if (ron == null) return "—";
  return `${ron.toFixed(2)} RON`;
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function marketplaceUrl(name: string): string {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `https://marketplace.roninchain.com/collections/grand-arena?search=${encodeURIComponent(name)}`;
}

type AcquisitionOption = {
  method: string;
  label: string;
  totalCostRON: number | null;
  cardsNeeded: number;
  unitPrice: number | null;
  available: boolean;
};

type AdvisorEntry = {
  rank: number;
  championTokenId: string;
  name: string;
  avgScore: number;
  winRate: number;
  avgKills: number;
  avgBalls: number;
  avgWartDistance: number;
  totalMatches: number;
  ownsLegendary: boolean;
  ownedRarity: string | null;
  acquisitionOptions: AcquisitionOption[];
  cheapestOption: AcquisitionOption | null;
  cheapestCostRON: number | null;
};

// ─── Sub-components ─────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-gold font-bold text-base">🥇</span>;
  if (rank === 2) return <span className="text-slate-300 font-bold text-base">🥈</span>;
  if (rank === 3) return <span className="text-amber-600 font-bold text-base">🥉</span>;
  return <span className="text-muted-foreground font-mono text-sm">#{rank}</span>;
}

function OwnershipBadge({ entry }: { entry: AdvisorEntry }) {
  if (entry.ownsLegendary) {
    return (
      <Badge className="bg-rarity-legendary/20 text-rarity-legendary border-rarity-legendary/40 gap-1">
        <Crown className="w-3 h-3" />
        Legendary ✓
      </Badge>
    );
  }
  if (entry.ownedRarity) {
    return (
      <Badge className={`${RARITY_BG[entry.ownedRarity] ?? ""} gap-1 text-xs`}>
        <CheckCircle2 className="w-3 h-3" />
        <span className={RARITY_COLORS[entry.ownedRarity] ?? ""}>
          {entry.ownedRarity}
        </span>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
      <XCircle className="w-3 h-3" />
      Not owned
    </Badge>
  );
}

function CheapestPathCell({ entry }: { entry: AdvisorEntry }) {
  if (entry.ownsLegendary) {
    return (
      <div className="flex items-center gap-1 text-rarity-legendary text-sm font-medium">
        <Crown className="w-4 h-4" />
        Already Legendary
      </div>
    );
  }
  if (!entry.cheapestOption) {
    return <span className="text-muted-foreground text-sm">No prices available</span>;
  }
  const opt = entry.cheapestOption;
  const isDirectBuy = opt.method === "buy_legendary";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {isDirectBuy ? (
          <ShoppingCart className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        ) : (
          <Hammer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <span className="text-sm font-semibold text-foreground">
          {formatRON(opt.totalCostRON)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{opt.label}</span>
    </div>
  );
}

function AcquisitionOptionsPanel({ entry }: { entry: AdvisorEntry }) {
  if (entry.ownsLegendary) {
    return (
      <div className="p-3 rounded-lg bg-rarity-legendary/10 border border-rarity-legendary/30 text-sm text-rarity-legendary flex items-center gap-2">
        <Crown className="w-4 h-4 shrink-0" />
        You already own a Legendary version of this champion. No action needed.
      </div>
    );
  }

  const available = entry.acquisitionOptions.filter((o) => o.available && o.totalCostRON != null);
  const unavailable = entry.acquisitionOptions.filter((o) => !o.available || o.totalCostRON == null);

  if (available.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-muted/30 border border-border text-sm text-muted-foreground">
        No marketplace listings found for this champion. Check{" "}
        <a
          href={marketplaceUrl(entry.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
        >
          Ronin Marketplace <ExternalLink className="w-3 h-3" />
        </a>{" "}
        manually.
      </div>
    );
  }

  // Sort by cost ascending
  const sorted = [...available].sort(
    (a, b) => (a.totalCostRON ?? Infinity) - (b.totalCostRON ?? Infinity)
  );

  return (
    <div className="space-y-1.5">
      {sorted.map((opt, i) => {
        const isCheapest = i === 0;
        return (
          <div
            key={opt.method}
            className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
              isCheapest
                ? "bg-gold/10 border-gold/40 text-foreground"
                : "bg-muted/20 border-border text-muted-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              {opt.method === "buy_legendary" ? (
                <ShoppingCart className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              ) : (
                <Hammer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span>{opt.label}</span>
              {isCheapest && (
                <Badge className="bg-gold/20 text-gold border-gold/40 text-xs py-0 px-1.5">
                  Best
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${isCheapest ? "text-gold" : ""}`}>
                {formatRON(opt.totalCostRON)}
              </span>
              {opt.method === "buy_legendary" && (
                <a
                  href={marketplaceUrl(entry.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        );
      })}
      {unavailable.length > 0 && (
        <div className="text-xs text-muted-foreground/60 pt-1">
          {unavailable.map((o) => o.label).join(", ")} — no listings found
        </div>
      )}
    </div>
  );
}

function ChampionRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AdvisorEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-muted/30 transition-colors ${
          entry.ownsLegendary ? "bg-rarity-legendary/5" : ""
        }`}
        onClick={onToggle}
      >
        {/* Rank */}
        <TableCell className="w-12 text-center">
          <RankBadge rank={entry.rank} />
        </TableCell>

        {/* Champion name */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">{entry.name}</span>
            <span className="text-xs text-muted-foreground">
              {entry.totalMatches} matches
            </span>
          </div>
        </TableCell>

        {/* Avg Score */}
        <TableCell className="text-right">
          <span className="font-mono text-sm font-semibold text-gold">
            {entry.avgScore.toFixed(0)}
          </span>
        </TableCell>

        {/* Win Rate */}
        <TableCell className="text-right">
          <span className="font-mono text-sm">
            {formatPct(entry.winRate)}
          </span>
        </TableCell>

        {/* Stats */}
        <TableCell className="hidden md:table-cell text-right">
          <span className="text-xs text-muted-foreground font-mono">
            {entry.avgKills.toFixed(1)}K / {entry.avgBalls.toFixed(1)}B / {entry.avgWartDistance.toFixed(0)}W
          </span>
        </TableCell>

        {/* Ownership */}
        <TableCell className="hidden sm:table-cell">
          <OwnershipBadge entry={entry} />
        </TableCell>

        {/* Cheapest path */}
        <TableCell>
          <CheapestPathCell entry={entry} />
        </TableCell>

        {/* Expand indicator */}
        <TableCell className="w-8 text-center text-muted-foreground text-xs">
          {expanded ? "▲" : "▼"}
        </TableCell>
      </TableRow>

      {/* Expanded acquisition options */}
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="py-2 px-4 bg-muted/10">
            <AcquisitionOptionsPanel entry={entry} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────
export default function LegendaryAdvisor() {
  const { isAuthenticated, user } = useAuth();
  const [selectedScheme, setSelectedScheme] = useState<string>("");
  const [topN, setTopN] = useState<number>(10);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const advisoryQuery = trpc.matchup.getLegendaryAdvisory.useQuery(
    { schemeName: selectedScheme, topN },
    {
      enabled: isAuthenticated && selectedScheme.length > 0,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  const data = advisoryQuery.data;
  const isLoading = advisoryQuery.isLoading && selectedScheme.length > 0;

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Summary stats
  const summary = useMemo(() => {
    if (!data?.topChampions?.length) return null;
    const owned = data.topChampions.filter((c) => c.ownsLegendary).length;
    const needAcquire = data.topChampions.filter((c) => !c.ownsLegendary);
    const withPrices = needAcquire.filter((c) => c.cheapestCostRON != null);
    const totalCost = withPrices.reduce((sum, c) => sum + (c.cheapestCostRON ?? 0), 0);
    return { owned, needAcquire: needAcquire.length, withPrices: withPrices.length, totalCost };
  }, [data]);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Crown className="w-12 h-12 text-rarity-legendary mx-auto" />
          <h2 className="text-xl font-semibold">Sign in to use the Legendary Advisor</h2>
          <p className="text-muted-foreground text-sm">
            This tool checks your wallet inventory and recommends the most economical path to Legendary cards.
          </p>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            className="bg-gold text-background hover:bg-gold/90"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-[Rajdhani] flex items-center gap-2">
            <Crown className="w-6 h-6 text-rarity-legendary" />
            Legendary Advisor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find the most economical path to Legendary cards for top-performing MOKIs
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5 text-gold" />
          <span>Crafting: 8 Epics → 1 Legendary (free)</span>
        </div>
      </div>

      {/* Controls */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Scheme Card
              </label>
              <Select value={selectedScheme} onValueChange={setSelectedScheme}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Select a scheme card…" />
                </SelectTrigger>
                <SelectContent>
                  {SCHEMES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Top N
              </label>
              <Select
                value={String(topN)}
                onValueChange={(v) => setTopN(Number(v))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 8, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Top {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Empty state */}
      {!selectedScheme && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <Swords className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            Select a scheme card above to see the top-ranked MOKIs and acquisition costs.
          </p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Fetching rankings and marketplace prices…</span>
        </div>
      )}

      {/* Error */}
      {advisoryQuery.isError && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="pt-4 text-sm text-destructive">
            Failed to load advisory data: {advisoryQuery.error.message}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {data && !isLoading && (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border-border/50">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Champions Ranked
                  </div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {data.topChampions.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    for {data.schemeName}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-rarity-legendary/30 bg-rarity-legendary/5">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Legendaries Owned
                  </div>
                  <div className="text-2xl font-bold font-mono text-rarity-legendary">
                    {summary.owned}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    of top {data.topChampions.length}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Still Needed
                  </div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {summary.needAcquire}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {summary.withPrices} have prices
                  </div>
                </CardContent>
              </Card>

              <Card className="border-gold/30 bg-gold/5">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Est. Total Cost
                  </div>
                  <div className="text-2xl font-bold font-mono text-gold">
                    {summary.totalCost > 0 ? `${summary.totalCost.toFixed(1)}` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    RON (cheapest paths)
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* No data */}
          {data.topChampions.length === 0 && (
            <Card className="border-border/50">
              <CardContent className="py-12 text-center text-muted-foreground">
                <TrendingUp className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p>No match data found for <strong>{data.schemeName}</strong>.</p>
                <p className="text-sm mt-1">
                  Run a match scrape from the Dashboard to collect Season 1 data.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Champion table */}
          {data.topChampions.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-gold" />
                  Top MOKIs for{" "}
                  <span className="text-gold">{data.schemeName}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Ranked by avg score (kills×80 + balls×50 + wart×0.5625 + win×300),
                      then win rate. Only champions with ≥5 Season 1 matches shown.
                      Click any row to see detailed acquisition options.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="w-12 text-center">#</TableHead>
                        <TableHead>Champion</TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help">Avg Score</TooltipTrigger>
                            <TooltipContent className="text-xs">
                              Average score per match (Season 1)
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">Win %</TableHead>
                        <TableHead className="hidden md:table-cell text-right">
                          K / B / W
                        </TableHead>
                        <TableHead className="hidden sm:table-cell">Owned</TableHead>
                        <TableHead>Cheapest Path</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topChampions.map((entry) => (
                        <ChampionRow
                          key={entry.championTokenId}
                          entry={entry}
                          expanded={expandedRows.has(entry.championTokenId)}
                          onToggle={() => toggleRow(entry.championTokenId)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Legend / footnotes */}
          {data.topChampions.length > 0 && (
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5 text-blue-400" />
                Direct buy on Ronin Marketplace
              </div>
              <div className="flex items-center gap-1.5">
                <Hammer className="w-3.5 h-3.5 text-amber-400" />
                Craft from lower rarity (8 Epics / 80 Rares / 240 Basics)
              </div>
              <div className="flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-rarity-legendary" />
                Already own Legendary
              </div>
              <div className="ml-auto">
                Data fetched: {new Date(data.fetchedAt).toLocaleTimeString()}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
