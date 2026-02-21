/**
 * Champion Stats — Performance rankings with scheme-relevance scoring.
 * Shows all 180 champions ranked by V4 scoring model with filters for
 * rarity, class, and scheme category.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Search,
  RefreshCw,
  TrendingUp,
  Swords,
  Target,
  Bug,
  Trophy,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";

const RARITIES = ["ALL", "Basic", "Rare", "Epic", "Legendary"];
const CLASSES = [
  "ALL",
  "Bruiser",
  "Center",
  "Anchor",
  "Flanker",
  "Forward",
  "Defender",
  "Grinder",
  "Support",
  "Sprinter",
  "Striker",
  "Unknown",
];
const SCHEME_CATEGORIES = [
  { value: "none", label: "Overall" },
  { value: "kills", label: "Kills Schemes" },
  { value: "balls", label: "Balls Schemes" },
  { value: "wart", label: "Wart Schemes" },
  { value: "win", label: "Win Schemes" },
  { value: "combo", label: "Combo Schemes" },
  { value: "trait", label: "Trait Schemes" },
  { value: "rarity", label: "Rarity Schemes" },
  { value: "score", label: "Score Schemes" },
  { value: "loss", label: "Loss Schemes" },
];
const SORT_OPTIONS = [
  { value: "overall", label: "Overall Rank" },
  { value: "v4Score", label: "V4 Score" },
  { value: "kills", label: "Est. Kills" },
  { value: "balls", label: "Est. Balls" },
  { value: "wart", label: "Est. Wart" },
  { value: "winRate", label: "Win Rate" },
];

const PAGE_SIZE = 25;

const RARITY_COLORS: Record<string, string> = {
  Basic: "bg-zinc-600 text-zinc-100",
  Rare: "bg-blue-600 text-blue-100",
  Epic: "bg-purple-600 text-purple-100",
  Legendary: "bg-amber-600 text-amber-100",
};

const FUR_COLORS: Record<string, string> = {
  Spirit: "text-cyan-400",
  Shadow: "text-purple-400",
  Rainbow: "text-pink-400",
  Gold: "text-yellow-400",
};

export default function ChampionStats() {
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState("ALL");
  const [championClass, setChampionClass] = useState("ALL");
  const [schemeCategory, setSchemeCategory] = useState("none");
  const [sortBy, setSortBy] = useState<"overall" | "kills" | "balls" | "wart" | "winRate" | "v4Score">("overall");
  const [offset, setOffset] = useState(0);

  const { data: rankings, isLoading, refetch } = trpc.stats.rankings.useQuery({
    sortBy,
    rarity,
    championClass,
    schemeCategory: schemeCategory !== "none" ? schemeCategory : undefined,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const { data: summary } = trpc.stats.summary.useQuery();
  const { data: classAverages } = trpc.stats.classAverages.useQuery();

  const refreshMutation = trpc.stats.refresh.useMutation({
    onSuccess: (data) => {
      toast.success(`Refreshed stats for ${data.totalChampions} champions`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = Math.ceil((rankings?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gold">
            Champion Stats
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Performance rankings based on V4 scoring model &middot;{" "}
            {summary?.totalChampions ?? 0} champions
          </p>
        </div>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          variant="outline"
          className="border-gold/30 text-gold hover:bg-gold/10"
        >
          {refreshMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh Stats
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <BarChart3 className="w-3.5 h-3.5" />
                Avg V4 Score
              </div>
              <div className="text-xl font-bold text-foreground">
                {summary.avgV4Score.toFixed(1)}
              </div>
            </CardContent>
          </Card>
          {summary.top5.slice(0, 3).map((champ, i) => (
            <Card key={i} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Trophy className="w-3.5 h-3.5 text-gold" />
                  #{champ.rank}
                </div>
                <div className="text-sm font-bold text-foreground truncate">
                  {champ.name}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${RARITY_COLORS[champ.rarity] ?? ""}`}
                  >
                    {champ.rarity}
                  </Badge>
                  <span className={`text-[10px] ${FUR_COLORS[champ.fur] ?? "text-muted-foreground"}`}>
                    {champ.fur}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search champion..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                className="pl-9 bg-background/50"
              />
            </div>

            <Select
              value={rarity}
              onValueChange={(v) => {
                setRarity(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Rarity" />
              </SelectTrigger>
              <SelectContent>
                {RARITIES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r === "ALL" ? "All Rarities" : r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={championClass}
              onValueChange={(v) => {
                setChampionClass(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>
                {CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "ALL" ? "All Classes" : c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={schemeCategory}
              onValueChange={(v) => {
                setSchemeCategory(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Scheme" />
              </SelectTrigger>
              <SelectContent>
                {SCHEME_CATEGORIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v as typeof sortBy);
                setOffset(0);
              }}
            >
              <SelectTrigger className="bg-background/50">
                <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Rankings Table */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : !rankings || rankings.champions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No champions found matching your filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground text-xs">
                      <th className="text-left p-3 w-12">#</th>
                      <th className="text-left p-3">Champion</th>
                      <th className="text-left p-3">Rarity</th>
                      <th className="text-left p-3">Fur</th>
                      <th className="text-left p-3">Class</th>
                      <th className="text-right p-3">
                        <span className="inline-flex items-center gap-1">
                          <Swords className="w-3 h-3" /> Kills
                        </span>
                      </th>
                      <th className="text-right p-3">
                        <span className="inline-flex items-center gap-1">
                          <Target className="w-3 h-3" /> Balls
                        </span>
                      </th>
                      <th className="text-right p-3">
                        <span className="inline-flex items-center gap-1">
                          <Bug className="w-3 h-3" /> Wart
                        </span>
                      </th>
                      <th className="text-right p-3">Win %</th>
                      <th className="text-right p-3">V4 Score</th>
                      {schemeCategory !== "none" && (
                        <th className="text-right p-3 text-gold">Scheme Score</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.champions.map((champ, i) => (
                      <tr
                        key={champ.championTokenId}
                        className="border-b border-border/20 hover:bg-gold/5 transition-colors"
                      >
                        <td className="p-3 text-muted-foreground font-mono text-xs">
                          {offset + i + 1}
                        </td>
                        <td className="p-3">
                          <div className="font-medium text-foreground">
                            {champ.name}
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${RARITY_COLORS[champ.rarity] ?? ""}`}
                          >
                            {champ.rarity}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <span
                            className={`text-xs ${FUR_COLORS[champ.fur] ?? "text-muted-foreground"}`}
                          >
                            {champ.fur}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {champ.championClass}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {champ.estKills.toFixed(2)}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {champ.estBalls.toFixed(2)}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {champ.estWartDistance.toFixed(1)}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {(champ.estWinRate * 100).toFixed(1)}%
                        </td>
                        <td className="p-3 text-right font-mono text-xs font-bold text-teal">
                          {champ.v4RarityScore.toFixed(1)}
                        </td>
                        {schemeCategory !== "none" && (
                          <td className="p-3 text-right font-mono text-xs font-bold text-gold">
                            {(champ.schemeScores?.[schemeCategory] ?? 0).toFixed(1)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4 border-t border-border/30">
                <span className="text-xs text-muted-foreground">
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, rankings.total)} of{" "}
                  {rankings.total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    className="border-border/50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!rankings.hasMore}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    className="border-border/50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Class Performance Reference */}
      {classAverages && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Class Performance Averages (from GATracker META)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="text-left p-2">Class</th>
                    <th className="text-right p-2">Avg Kills</th>
                    <th className="text-right p-2">Avg Balls</th>
                    <th className="text-right p-2">Avg Wart</th>
                    <th className="text-right p-2">Win Rate</th>
                    <th className="text-left p-2">Primary Stat</th>
                  </tr>
                </thead>
                <tbody>
                  {classAverages.map((cls) => (
                    <tr
                      key={cls.className}
                      className="border-b border-border/10 hover:bg-gold/5"
                    >
                      <td className="p-2 font-medium text-foreground">
                        {cls.className}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {cls.avgKills.toFixed(2)}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {cls.avgBalls.toFixed(2)}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {cls.avgWartDistance.toFixed(1)}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {(cls.winRate * 100).toFixed(1)}%
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {cls.primaryStat}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
