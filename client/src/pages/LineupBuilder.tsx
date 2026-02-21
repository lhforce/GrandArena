/**
 * Lineup Builder — Interactive contest optimizer with card artwork display.
 * Mobile responsive. Uses actual card images from wallet sync (rarity-specific).
 */

import { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
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
import { toast } from "sonner";
import {
  Loader2, Swords, Trophy, Gem, AlertTriangle, ChevronRight,
  Crown, Sparkles, Zap, Lock, Save, Users, RefreshCw,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────────
const RARITY_COLORS: Record<string, string> = {
  Basic: "text-rarity-basic", Common: "text-rarity-basic",
  Rare: "text-rarity-rare", Epic: "text-rarity-epic", Legendary: "text-rarity-legendary",
};
const RARITY_BORDER: Record<string, string> = {
  Basic: "border-rarity-basic/40", Common: "border-rarity-basic/40",
  Rare: "border-rarity-rare/40", Epic: "border-rarity-epic/40", Legendary: "border-rarity-legendary/40",
};
const RARITY_BG: Record<string, string> = {
  Basic: "bg-rarity-basic", Common: "bg-rarity-basic",
  Rare: "bg-rarity-rare", Epic: "bg-rarity-epic", Legendary: "bg-rarity-legendary",
};
const FORMAT_LABELS: Record<string, string> = {
  "50/50": "50/50", "Top 20%": "Top 20%", "Free Entry": "Free",
};

export default function LineupBuilder() {
  const { isAuthenticated } = useAuth();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const preselectedContestId = searchParams.get("contestId");

  const [selectedContestId, setSelectedContestId] = useState<number | null>(
    preselectedContestId ? Number(preselectedContestId) : null
  );
  const [numEntries, setNumEntries] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>(
    preselectedContestId ? "OPEN" : "LIVE"
  );

  const contestsQuery = trpc.contests.list.useQuery({ status: statusFilter, limit: 50, offset: 0 });
  const budgetQuery = trpc.lineup.gemBudget.useQuery(undefined, { enabled: isAuthenticated });
  const inventoryQuery = trpc.lineup.inventory.useQuery(undefined, { enabled: isAuthenticated });
  const lockupsQuery = trpc.lineup.lockups.useQuery(undefined, { enabled: isAuthenticated });

  const utils = trpc.useUtils();

  const refreshActive = trpc.contests.refreshActive.useMutation({
    onSuccess: (result) => {
      toast.success("Refreshed", { description: `Updated ${result.refreshed} active contests` });
      utils.contests.list.invalidate();
    },
    onError: (err) => toast.error(`Refresh failed: ${err.message}`),
  });

  const optimizeMutation = trpc.lineup.optimize.useMutation({
    onSuccess: (data) => toast.success(`Built ${data.lineups.length} lineup${data.lineups.length > 1 ? "s" : ""}`),
    onError: (err) => toast.error(`Optimization failed: ${err.message}`),
  });

  const saveLineupMutation = trpc.lineup.saveLineup.useMutation({
    onSuccess: (data) => toast.success(data.updated ? "Lineup updated" : "Lineup saved"),
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const selectedContest = useMemo(() => {
    if (!selectedContestId || !contestsQuery.data) return null;
    return contestsQuery.data.contests.find((c) => c.id === selectedContestId);
  }, [selectedContestId, contestsQuery.data]);

  const handleOptimize = () => {
    if (!selectedContestId) { toast.error("Select a contest first"); return; }
    optimizeMutation.mutate({ contestId: selectedContestId, numEntries });
  };

  const handleSaveLineup = (lineup: any, entryNumber: number) => {
    if (!selectedContestId) return;
    saveLineupMutation.mutate({
      contestId: selectedContestId, entryNumber,
      champion1TokenId: lineup.champions[0]?.champion.tokenId ?? "",
      champion2TokenId: lineup.champions[1]?.champion.tokenId ?? "",
      champion3TokenId: lineup.champions[2]?.champion.tokenId ?? "",
      champion4TokenId: lineup.champions[3]?.champion.tokenId ?? "",
      schemeTokenId: lineup.schemeTokenId, predictedScore: lineup.predictedScore, status: "draft",
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Lineup Builder</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">Build optimal lineups for contests</p>
        </div>
        <Card className="glass-card border-gold/20">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4 px-4">
            <Lock className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm text-center">Log in and set your wallet in Settings to use the Lineup Builder.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Lineup Builder</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">Build optimal lineups from your owned cards</p>
      </div>

      {/* Budget & Inventory Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="glass-card">
          <CardContent className="p-3 sm:pt-4 sm:pb-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Gem className="w-3.5 h-3.5 text-teal" /> Gems
            </div>
            <div className="text-base sm:text-xl font-bold">
              {budgetQuery.data ? (
                <><span className="text-teal">{budgetQuery.data.remaining.toLocaleString()}</span>
                <span className="text-muted-foreground text-xs font-normal"> / {budgetQuery.data.dailyBudget.toLocaleString()}</span></>
              ) : <span className="text-muted-foreground">—</span>}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 sm:pt-4 sm:pb-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Swords className="w-3.5 h-3.5 text-gold" /> MOKIs
            </div>
            <div className="text-base sm:text-xl font-bold">{inventoryQuery.data?.totalMokis ?? "—"}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 sm:pt-4 sm:pb-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Sparkles className="w-3.5 h-3.5 text-rarity-epic" /> Schemes
            </div>
            <div className="text-base sm:text-xl font-bold">{inventoryQuery.data?.totalSchemes ?? "—"}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 sm:pt-4 sm:pb-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Lock className="w-3.5 h-3.5 text-destructive" /> Locked
            </div>
            <div className="text-base sm:text-xl font-bold">{lockupsQuery.data?.length ?? "—"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Contest Selection */}
      <Card className="glass-card border-gold/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-gold" /> Select Contest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2">
            {["LIVE", "OPEN", "DRAFT"].map((status) => (
              <Button key={status} variant={statusFilter === status ? "default" : "outline"} size="sm"
                onClick={() => { setStatusFilter(status); setSelectedContestId(null); }}
                className={`h-9 text-xs sm:text-sm ${statusFilter === status ? "bg-gold text-background" : ""}`}>
                {status === "DRAFT" ? "Upcoming" : status}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => refreshActive.mutate()}
              disabled={refreshActive.isPending}
              className="h-9 text-xs sm:text-sm border-teal/30 text-teal hover:bg-teal/10 ml-auto">
              {refreshActive.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {contestsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : contestsQuery.data?.contests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No {statusFilter.toLowerCase()} contests found.</p>
              <p className="text-xs mt-1">Scrape contests from Dashboard first.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {contestsQuery.data?.contests.map((contest) => {
                const maxE = contest.maxEntries;
                const curEntries = contest.entries ?? 0;
                const isUnlimited = maxE === null || maxE === 0;
                const isFull = !isUnlimited && curEntries >= maxE;
                const spotsLeft = isUnlimited ? Infinity : maxE - curEntries;
                return (
                <div key={contest.id} onClick={() => !isFull && setSelectedContestId(contest.id)}
                  className={`p-2.5 sm:p-3 rounded-lg border transition-all ${
                    isFull ? "border-border/50 opacity-50 cursor-not-allowed" :
                    selectedContestId === contest.id ? "border-gold bg-gold/10 cursor-pointer" : "border-border hover:border-gold/40 cursor-pointer"
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-xs sm:text-sm truncate">{contest.name}</span>
                        <Badge variant="outline" className="text-[10px] h-5">{FORMAT_LABELS[contest.format] ?? contest.format}</Badge>
                        {contest.rarityRestriction && contest.rarityRestriction !== "OPEN" && (
                          <Badge className={`text-[10px] h-5 ${RARITY_BG[contest.rarityRestriction.replace("_ONLY", "")] ?? "bg-muted"}`}>
                            {contest.rarityRestriction.replace("_ONLY", "").replace("_", " ")}
                          </Badge>
                        )}
                        {isFull && (
                          <Badge className="text-[9px] h-4 bg-destructive/20 text-destructive border-destructive/30">FULL</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4 mt-1 text-[10px] sm:text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-0.5"><Gem className="w-3 h-3" />{contest.entryFee ?? 0}g</span>
                        <span className="flex items-center gap-0.5"><Trophy className="w-3 h-3" />{Number(contest.prizePool ?? 0).toLocaleString()}</span>
                        <span className="flex items-center gap-0.5">
                          <Users className="w-3 h-3" />
                          {curEntries}/{isUnlimited ? "\u221E" : maxE}
                          {!isFull && spotsLeft <= 20 && spotsLeft > 0 && (
                            <span className="text-gold">({spotsLeft} left)</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${selectedContestId === contest.id ? "text-gold rotate-90" : "text-muted-foreground"}`} />
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Optimizer Controls */}
      {selectedContest && (
        <Card className="glass-card border-teal/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-teal" />
              <span className="truncate">Build: {selectedContest.name}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
              <div className="flex-1">
                <label className="text-xs sm:text-sm text-muted-foreground mb-1 block">Entries</label>
                <Select value={String(numEntries)} onValueChange={(v) => setNumEntries(Number(v))}>
                  <SelectTrigger className="w-full sm:w-32 h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: selectedContest.maxEntriesPerUser ?? 1 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "entry" : "entries"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-xs text-muted-foreground">Cost</div>
                <div className="text-base sm:text-lg font-bold text-teal">
                  {((selectedContest.entryFee ?? 0) * numEntries).toLocaleString()} gems
                </div>
              </div>
              <Button onClick={handleOptimize} disabled={optimizeMutation.isPending}
                className="bg-gold text-background hover:bg-gold/90 h-11 sm:h-12 px-6 w-full sm:w-auto">
                {optimizeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                Optimize
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results with Card Artwork */}
      {optimizeMutation.data && (
        <div className="space-y-4">
          {optimizeMutation.data.warnings.length > 0 && (
            <Card className="glass-card border-destructive/30">
              <CardContent className="p-3 sm:pt-4 sm:pb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {optimizeMutation.data.warnings.map((w: string, i: number) => (
                      <p key={i} className="text-xs sm:text-sm text-destructive">{w}</p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            <span><strong className="text-foreground">{optimizeMutation.data.totalEntries}</strong> lineups</span>
            <span>Cost: <strong className="text-teal">{optimizeMutation.data.gemCost.toLocaleString()}</strong></span>
            <span>Budget left: <strong className="text-teal">{optimizeMutation.data.remainingBudget.toLocaleString()}</strong></span>
          </div>

          {optimizeMutation.data.lineups.map((lineup: any, idx: number) => (
            <Card key={idx} className="glass-card border-gold/20">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Crown className="w-4 h-4 text-gold" /> Entry #{lineup.entryNumber}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      <strong className="text-gold">{lineup.predictedScore.toLocaleString()}</strong> pts
                    </span>
                    <Button size="sm" variant="outline" onClick={() => handleSaveLineup(lineup, lineup.entryNumber)}
                      disabled={saveLineupMutation.isPending} className="h-8 text-xs">
                      <Save className="w-3 h-3 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                  {/* Champion Cards with Artwork — uses imageUrl from optimizer (rarity-specific) */}
                  {lineup.champions.map((slot: any, ci: number) => {
                    const imgUrl = slot.champion.imageUrl;
                    return (
                      <div key={ci} className={`rounded-lg border ${RARITY_BORDER[slot.champion.rarity] ?? "border-border"} bg-card/50 overflow-hidden text-center`}>
                        {/* Card Image */}
                        <div className="aspect-[3/4] relative bg-background/30">
                          {imgUrl ? (
                            <img
                              src={imgUrl}
                              alt={slot.champion.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Swords className={`w-6 h-6 sm:w-8 sm:h-8 ${RARITY_COLORS[slot.champion.rarity] ?? "text-muted-foreground"}`} />
                            </div>
                          )}
                          {/* Score overlay */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                            <div className="text-[9px] sm:text-[10px] text-gold font-bold">
                              {slot.score.toLocaleString()} pts
                            </div>
                          </div>
                        </div>
                        {/* Card Info */}
                        <div className="p-1 sm:p-1.5">
                          <div className="text-[8px] sm:text-[10px] font-medium truncate" title={slot.champion.name}>
                            {slot.champion.name}
                          </div>
                          <Badge variant="outline" className={`text-[7px] sm:text-[9px] h-3.5 sm:h-4 mt-0.5 ${RARITY_COLORS[slot.champion.rarity] ?? ""}`}>
                            {slot.champion.rarity}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}

                  {/* Scheme Card with Artwork — uses imageUrl from optimizer */}
                  <div className="rounded-lg border border-teal/30 bg-teal/5 overflow-hidden text-center">
                    <div className="aspect-[3/4] relative bg-background/30">
                      {lineup.scheme?.imageUrl ? (
                        <img
                          src={lineup.scheme.imageUrl}
                          alt={lineup.scheme.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Sparkles className={`w-6 h-6 sm:w-8 sm:h-8 ${lineup.scheme ? "text-teal" : "text-teal/40"}`} />
                        </div>
                      )}
                    </div>
                    <div className="p-1 sm:p-1.5">
                      <div className="text-[8px] sm:text-[10px] font-medium truncate" title={lineup.scheme?.name ?? "No Scheme"}>
                        {lineup.scheme?.name ?? "None"}
                      </div>
                      <Badge variant="outline" className="text-[7px] sm:text-[9px] h-3.5 sm:h-4 mt-0.5 text-teal">Scheme</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
