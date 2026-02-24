/**
 * Lineup Builder — Interactive contest optimizer with card artwork display.
 * Mobile responsive. Uses actual card images from wallet sync (rarity-specific).
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Loader2, Swords, Trophy, Gem, AlertTriangle, ChevronRight,
  Crown, Sparkles, Zap, Lock, Save, Users, RefreshCw, ShoppingCart, BarChart3,
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
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [buildHighlight, setBuildHighlight] = useState(false);
  // Per-entry toggle: 'best' = Best Possible, 'myCards' = My Cards Only
  const [entryMode, setEntryMode] = useState<Record<number, 'best' | 'myCards'>>({});
  const buildBoxRef = useRef<HTMLDivElement>(null);
  const lineupsRef = useRef<HTMLDivElement>(null);

  const getEntryMode = (entryNum: number) => entryMode[entryNum] ?? 'myCards';
  const toggleEntryMode = (entryNum: number) => {
    setEntryMode(prev => ({
      ...prev,
      [entryNum]: prev[entryNum] === 'myCards' ? 'best' : 'myCards',
    }));
  };

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
    onSuccess: (data) => {
      toast.success(`Built ${data.lineups.length} lineup${data.lineups.length > 1 ? "s" : ""}`);
      // Auto-scroll to first lineup after optimization completes
      setTimeout(() => {
        lineupsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    },
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
            {["OPEN", "LIVE", "DRAFT"].map((status) => (
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
                <div key={contest.id} onClick={() => {
                    if (isFull) return;
                    setSelectedContestId(contest.id);
                    // Auto-scroll to Build box and highlight it
                    setBuildHighlight(true);
                    setTimeout(() => {
                      buildBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 100);
                    setTimeout(() => setBuildHighlight(false), 2500);
                  }}
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
        <Card ref={buildBoxRef} className={`glass-card transition-all duration-500 ${
          buildHighlight ? "border-gold ring-2 ring-gold/50 shadow-[0_0_20px_rgba(255,215,0,0.15)]" : "border-teal/20"
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-teal" />
              <span className="truncate">Build: {selectedContest.name}</span>
            </CardTitle>
            {/* Contest rules summary below title */}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {selectedContest.format && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {selectedContest.format}
                </Badge>
              )}
              {selectedContest.rarityRestriction && selectedContest.rarityRestriction !== "OPEN" && (
                <Badge className={`text-[10px] h-5 ${
                  selectedContest.rarityRestriction.includes("LEGENDARY") ? "bg-pink-500/20 text-pink-300 border-pink-500/30" :
                  selectedContest.rarityRestriction.includes("EPIC") ? "bg-purple-500/20 text-purple-300 border-purple-500/30" :
                  selectedContest.rarityRestriction.includes("RARE") ? "bg-green-500/20 text-green-300 border-green-500/30" :
                  selectedContest.rarityRestriction.includes("COMMON") ? "bg-gray-500/20 text-gray-300 border-gray-500/30" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {selectedContest.rarityRestriction.replace(/_/g, " ")}
                </Badge>
              )}
              {selectedContest.isOneOfEach && (
                <Badge className="text-[10px] h-5 bg-blue-500/20 text-blue-300 border-blue-500/30">
                  One of Each Rarity
                </Badge>
              )}
              {selectedContest.isStarCap && (
                <Badge className="text-[10px] h-5 bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
                  Star Cap
                </Badge>
              )}
              {selectedContest.maxEntriesPerUser != null && (
                <Badge variant="outline" className="text-[10px] h-5">
                  Max {selectedContest.maxEntriesPerUser} {selectedContest.maxEntriesPerUser === 1 ? "entry" : "entries"}
                </Badge>
              )}
              {selectedContest.entryFee != null && selectedContest.entryFee > 0 && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {selectedContest.entryFee.toLocaleString()} gems/entry
                </Badge>
              )}
              {selectedContest.prizePool != null && Number(selectedContest.prizePool) > 0 && (
                <Badge className="text-[10px] h-5 bg-gold/20 text-gold border-gold/30">
                  ${selectedContest.prizePool.toLocaleString()} prize
                </Badge>
              )}
              {selectedContest.entries != null && selectedContest.maxEntries != null && selectedContest.maxEntries > 0 && (
                <Badge variant="outline" className={`text-[10px] h-5 ${
                  selectedContest.entries >= selectedContest.maxEntries ? "text-red-400 border-red-400/30" :
                  selectedContest.entries / selectedContest.maxEntries >= 0.9 ? "text-orange-400 border-orange-400/30" :
                  "text-muted-foreground"
                }`}>
                  {selectedContest.entries}/{selectedContest.maxEntries} entered
                </Badge>
              )}
            </div>
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
        <div ref={lineupsRef} className="space-y-4">
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

          {/* Empirical Data Confidence Indicator */}
          {optimizeMutation.data.empiricalData && (
            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground bg-card/50 rounded-lg px-3 py-2 border border-border/50">
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                optimizeMutation.data.empiricalData.totalEntriesAnalyzed > 100
                  ? "bg-green-500" : optimizeMutation.data.empiricalData.totalEntriesAnalyzed > 0
                  ? "bg-gold" : "bg-muted-foreground"
              }`} />
              <span>
                {optimizeMutation.data.empiricalData.totalEntriesAnalyzed > 0 ? (
                  <>Scoring uses <strong className="text-foreground">{optimizeMutation.data.empiricalData.championsWithData}</strong> champions from <strong className="text-foreground">{optimizeMutation.data.empiricalData.totalEntriesAnalyzed}</strong> winning entries across <strong className="text-foreground">{optimizeMutation.data.empiricalData.totalContestsAnalyzed}</strong> contests</>
                ) : (
                  <>Scoring uses class-based model estimates. Run AI Identify on Dashboard to improve accuracy with real contest data.</>
                )}
              </span>
            </div>
          )}

          {optimizeMutation.data.lineups.map((lineup: any, idx: number) => {
            const entryNum = lineup.entryNumber;
            const mode = getEntryMode(entryNum);
            const myCardsLineup = optimizeMutation.data.myCardsLineups?.[idx];
            const activeLineup = mode === 'myCards' && myCardsLineup ? myCardsLineup : lineup;

            return (
            <Card key={idx} className="glass-card border-gold/20">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Crown className="w-4 h-4 text-gold" /> Entry #{entryNum}
                    {/* My Cards / Best Possible toggle */}
                    <div className="flex items-center ml-2 bg-muted/50 rounded-full p-0.5">
                      <button
                        onClick={() => setEntryMode(prev => ({ ...prev, [entryNum]: 'best' }))}
                        className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium transition-all ${
                          mode === 'best'
                            ? 'bg-gold text-black shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Trophy className="w-2.5 h-2.5 inline mr-0.5" />Best
                      </button>
                      <button
                        onClick={() => setEntryMode(prev => ({ ...prev, [entryNum]: 'myCards' }))}
                        className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium transition-all ${
                          mode === 'myCards'
                            ? 'bg-teal text-black shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Lock className="w-2.5 h-2.5 inline mr-0.5" />My Cards
                      </button>
                    </div>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      <strong className="text-gold">{activeLineup.predictedScore.toLocaleString()}</strong> pts
                    </span>
                    {/* Confidence indicator */}
                    {activeLineup.confidence && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className={`text-[9px] sm:text-[10px] h-5 cursor-help ${
                                activeLineup.confidence.label === 'High'
                                  ? 'border-green-500/50 text-green-400 bg-green-500/10'
                                  : activeLineup.confidence.label === 'Medium'
                                  ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10'
                                  : 'border-red-500/50 text-red-400 bg-red-500/10'
                              }`}
                            >
                              <BarChart3 className="w-2.5 h-2.5 mr-0.5" />
                              {activeLineup.confidence.score}%
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                            <p className="font-medium mb-1">Confidence: {activeLineup.confidence.label} ({activeLineup.confidence.score}%)</p>
                            <p className="text-muted-foreground">
                              {activeLineup.confidence.sources.match_history > 0 && `${activeLineup.confidence.sources.match_history} champs from match history \u00b7 `}
                              {activeLineup.confidence.sources.empirical > 0 && `${activeLineup.confidence.sources.empirical} from leaderboard data \u00b7 `}
                              {activeLineup.confidence.sources.model > 0 && `${activeLineup.confidence.sources.model} from stat model`}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleSaveLineup(activeLineup, entryNum)}
                      disabled={saveLineupMutation.isPending} className="h-8 text-xs">
                      <Save className="w-3 h-3 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                  {/* Champion Cards with Artwork — uses imageUrl from optimizer (rarity-specific) */}
                  {/* Best Possible mode: hypothetical Legendary banner */}
                  {mode === 'best' && (
                    <div className="col-span-5 mb-1 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1">
                      <Trophy className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="text-[9px] sm:text-[10px] text-amber-300">
                        <strong>Hypothetical lineup</strong> — showing best possible champions at Legendary rarity. Switch to <strong>My Cards</strong> to see your actual owned cards.
                      </span>
                    </div>
                  )}
                  {activeLineup.champions.map((slot: any, ci: number) => {
                    const imgUrl = slot.champion.imageUrl;
                    // In Best Possible mode, rarity is forced to Legendary by the backend.
                    // In My Cards mode, rarity is the actual owned card rarity.
                    const displayRarity = slot.champion.rarity;
                    const isHypothetical = mode === 'best';
                    return (
                      <div key={ci} className={`rounded-lg border ${RARITY_BORDER[displayRarity] ?? "border-border"} bg-card/50 overflow-hidden text-center relative`}>
                        {/* Hypothetical overlay badge */}
                        {isHypothetical && (
                          <div className="absolute top-0.5 left-0.5 z-10">
                            <span className="text-[6px] bg-amber-500/80 text-black font-bold px-0.5 py-px rounded leading-none">IDEAL</span>
                          </div>
                        )}
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
                              <Swords className={`w-6 h-6 sm:w-8 sm:h-8 ${RARITY_COLORS[displayRarity] ?? "text-muted-foreground"}`} />
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
                          <Badge variant="outline" className={`text-[7px] sm:text-[9px] h-3.5 sm:h-4 mt-0.5 ${RARITY_COLORS[displayRarity] ?? ""}`}>
                            {isHypothetical ? "Legendary ✦" : displayRarity}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}

                  {/* Scheme Card with Artwork — uses imageUrl from optimizer */}
                  <div className="rounded-lg border border-teal/30 bg-teal/5 overflow-hidden text-center">
                    <div className="aspect-[3/4] relative bg-background/30">
                      {activeLineup.scheme?.imageUrl ? (
                        <img
                          src={activeLineup.scheme.imageUrl}
                          alt={activeLineup.scheme.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Sparkles className={`w-6 h-6 sm:w-8 sm:h-8 ${activeLineup.scheme ? "text-teal" : "text-teal/40"}`} />
                        </div>
                      )}
                    </div>
                    <div className="p-1 sm:p-1.5">
                      <div className="text-[8px] sm:text-[10px] font-medium truncate" title={activeLineup.scheme?.name ?? "No Scheme"}>
                        {activeLineup.scheme?.name ?? "None"}
                      </div>
                      <Badge variant="outline" className="text-[7px] sm:text-[9px] h-3.5 sm:h-4 mt-0.5 text-teal">Scheme</Badge>
                    </div>
                  </div>
                </div>

                {/* Buy Recommendation for 3-qualifier trait lineups */}
                {activeLineup.isPartialTraitLineup && activeLineup.buyRecommendation && (
                  <div className="mt-3 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <ShoppingCart className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-amber-300 font-medium">
                          {activeLineup.buyRecommendation.reason}
                        </span>
                        <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                          This lineup has 3 qualifying MOKIs — buying the 4th will unlock the full trait bonus (+500 pts)
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
