/**
 * Champion Stats — Performance rankings. Mobile responsive.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Search, RefreshCw, TrendingUp, Swords, Target, Bug, Trophy,
  ChevronLeft, ChevronRight, BarChart3, ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";

const RARITIES = ["ALL", "Basic", "Rare", "Epic", "Legendary"];
const CLASSES = ["ALL", "Bruiser", "Center", "Anchor", "Flanker", "Forward", "Defender", "Grinder", "Support", "Sprinter", "Striker", "Unknown"];
const SCHEME_CATEGORIES = [
  { value: "none", label: "Overall" }, { value: "kills", label: "Kills" },
  { value: "balls", label: "Balls" }, { value: "wart", label: "Wart" },
  { value: "win", label: "Win" }, { value: "combo", label: "Combo" },
  { value: "trait", label: "Trait" }, { value: "rarity", label: "Rarity" },
  { value: "score", label: "Score" }, { value: "loss", label: "Loss" },
];
const SORT_OPTIONS = [
  { value: "overall", label: "Overall" }, { value: "v4Score", label: "V4 Score" },
  { value: "kills", label: "Kills" }, { value: "balls", label: "Balls" },
  { value: "wart", label: "Wart" }, { value: "winRate", label: "Win %" },
];
const PAGE_SIZE = 25;
const RARITY_COLORS: Record<string, string> = {
  Basic: "bg-zinc-600 text-zinc-100", Rare: "bg-blue-600 text-blue-100",
  Epic: "bg-purple-600 text-purple-100", Legendary: "bg-amber-600 text-amber-100",
};
const FUR_COLORS: Record<string, string> = {
  Spirit: "text-cyan-400", Shadow: "text-purple-400", Rainbow: "text-pink-400", Gold: "text-yellow-400",
};

export default function ChampionStats() {
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState("ALL");
  const [championClass, setChampionClass] = useState("ALL");
  const [schemeCategory, setSchemeCategory] = useState("none");
  const [sortBy, setSortBy] = useState<"overall" | "kills" | "balls" | "wart" | "winRate" | "v4Score">("overall");
  const [offset, setOffset] = useState(0);

  const { data: rankings, isLoading, refetch } = trpc.stats.rankings.useQuery({
    sortBy, rarity, championClass,
    schemeCategory: schemeCategory !== "none" ? schemeCategory : undefined,
    search: search.trim() || undefined, limit: PAGE_SIZE, offset,
  });
  const { data: summary } = trpc.stats.summary.useQuery();
  const { data: classAverages } = trpc.stats.classAverages.useQuery();

  const refreshMutation = trpc.stats.refresh.useMutation({
    onSuccess: (data) => { toast.success(`Refreshed ${data.totalChampions} champions`); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = Math.ceil((rankings?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-gold">Champion Stats</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">V4 scoring &middot; {summary?.totalChampions ?? 0} champions</p>
        </div>
        <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
          variant="outline" className="border-gold/30 text-gold hover:bg-gold/10 h-10 self-start sm:self-auto">
          {refreshMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] sm:text-xs mb-1"><BarChart3 className="w-3 h-3" /> Avg V4</div>
              <div className="text-base sm:text-xl font-bold">{summary.avgV4Score.toFixed(1)}</div>
            </CardContent>
          </Card>
          {summary.top5.slice(0, 3).map((champ, i) => (
            <Card key={i} className="bg-card/50 border-border/50">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] sm:text-xs mb-1"><Trophy className="w-3 h-3 text-gold" /> #{champ.rank}</div>
                <div className="text-xs sm:text-sm font-bold truncate">{champ.name}</div>
                <Badge variant="outline" className={`text-[8px] sm:text-[10px] px-1 py-0 mt-0.5 ${RARITY_COLORS[champ.rarity] ?? ""}`}>{champ.rarity}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="relative col-span-2 sm:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search..." value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} className="pl-9 h-10" />
            </div>
            <Select value={rarity} onValueChange={(v) => { setRarity(v); setOffset(0); }}>
              <SelectTrigger className="h-10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{RARITIES.map((r) => <SelectItem key={r} value={r}>{r === "ALL" ? "All Rarity" : r}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={championClass} onValueChange={(v) => { setChampionClass(v); setOffset(0); }}>
              <SelectTrigger className="h-10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CLASSES.map((c) => <SelectItem key={c} value={c}>{c === "ALL" ? "All Class" : c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={schemeCategory} onValueChange={(v) => { setSchemeCategory(v); setOffset(0); }}>
              <SelectTrigger className="h-10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SCHEME_CATEGORIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => { setSortBy(v as typeof sortBy); setOffset(0); }}>
              <SelectTrigger className="h-10 text-xs"><ArrowUpDown className="w-3 h-3 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>{SORT_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
          ) : !rankings || rankings.champions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">No champions found.</div>
          ) : (
            <>
              <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                <table className="w-full text-xs sm:text-sm min-w-[550px]">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground text-[10px] sm:text-xs">
                      <th className="text-left p-2 w-8">#</th>
                      <th className="text-left p-2">Champion</th>
                      <th className="text-left p-2">Rar</th>
                      <th className="text-right p-2">K</th>
                      <th className="text-right p-2">B</th>
                      <th className="text-right p-2">W%</th>
                      <th className="text-right p-2">V4</th>
                      {schemeCategory !== "none" && <th className="text-right p-2 text-gold">Sch</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.champions.map((champ, i) => (
                      <tr key={champ.championTokenId} className="border-b border-border/20 hover:bg-gold/5">
                        <td className="p-2 text-muted-foreground font-mono text-[10px]">{offset + i + 1}</td>
                        <td className="p-2"><div className="font-medium text-xs truncate max-w-[100px] sm:max-w-none">{champ.name}</div></td>
                        <td className="p-2"><Badge variant="outline" className={`text-[8px] px-1 py-0 ${RARITY_COLORS[champ.rarity] ?? ""}`}>{champ.rarity}</Badge></td>
                        <td className="p-2 text-right font-mono text-[10px]">{champ.estKills.toFixed(1)}</td>
                        <td className="p-2 text-right font-mono text-[10px]">{champ.estBalls.toFixed(1)}</td>
                        <td className="p-2 text-right font-mono text-[10px]">{(champ.estWinRate * 100).toFixed(0)}%</td>
                        <td className="p-2 text-right font-mono text-[10px] font-bold text-teal">{champ.v4RarityScore.toFixed(0)}</td>
                        {schemeCategory !== "none" && (
                          <td className="p-2 text-right font-mono text-[10px] font-bold text-gold">{(champ.schemeScores?.[schemeCategory] ?? 0).toFixed(0)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-3 border-t border-border/30">
                <span className="text-[10px] sm:text-xs text-muted-foreground">{offset + 1}-{Math.min(offset + PAGE_SIZE, rankings.total)} of {rankings.total}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="h-8 w-8 p-0"><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-[10px] text-muted-foreground">{currentPage}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={!rankings.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)} className="h-8 w-8 p-0"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {classAverages && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2"><TrendingUp className="w-3.5 h-3.5" /> Class Averages</CardTitle></CardHeader>
          <CardContent className="p-0 px-3 pb-3 sm:px-6 sm:pb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] sm:text-xs min-w-[350px]">
                <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2">Class</th><th className="text-right p-2">K</th><th className="text-right p-2">B</th><th className="text-right p-2">W</th><th className="text-right p-2">Win%</th></tr></thead>
                <tbody>
                  {classAverages.map((cls) => (
                    <tr key={cls.className} className="border-b border-border/10 hover:bg-gold/5">
                      <td className="p-2 font-medium">{cls.className}</td>
                      <td className="p-2 text-right font-mono">{cls.avgKills.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono">{cls.avgBalls.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono">{cls.avgWartDistance.toFixed(0)}</td>
                      <td className="p-2 text-right font-mono">{(cls.winRate * 100).toFixed(0)}%</td>
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
