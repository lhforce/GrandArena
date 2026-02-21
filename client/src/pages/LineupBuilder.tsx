/**
 * Lineup Builder — Interactive contest optimizer.
 * 1. Shows LIVE/OPEN/DRAFT contests from the database
 * 2. User picks a contest and number of entries
 * 3. Optimizer builds optimal lineups from owned cards
 * 4. Shows predicted scores, gem cost, and missing card recommendations
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Swords,
  Trophy,
  Gem,
  AlertTriangle,
  ChevronRight,
  Crown,
  Shield,
  Sparkles,
  Zap,
  Lock,
  Save,
  RefreshCw,
} from "lucide-react";

const RARITY_COLORS: Record<string, string> = {
  Basic: "text-rarity-basic",
  Common: "text-rarity-basic",
  Rare: "text-rarity-rare",
  Epic: "text-rarity-epic",
  Legendary: "text-rarity-legendary",
};

const RARITY_BG: Record<string, string> = {
  Basic: "bg-rarity-basic",
  Common: "bg-rarity-basic",
  Rare: "bg-rarity-rare",
  Epic: "bg-rarity-epic",
  Legendary: "bg-rarity-legendary",
};

const FORMAT_LABELS: Record<string, string> = {
  "50/50": "50/50 Split",
  "Top 20%": "Top 20%",
  "Free Entry": "Free Entry",
};

export default function LineupBuilder() {
  const { isAuthenticated } = useAuth();
  const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
  const [numEntries, setNumEntries] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("LIVE");

  // Fetch active contests
  const contestsQuery = trpc.contests.list.useQuery({
    status: statusFilter,
    limit: 50,
    offset: 0,
  });

  // Fetch gem budget
  const budgetQuery = trpc.lineup.gemBudget.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Fetch inventory summary
  const inventoryQuery = trpc.lineup.inventory.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Fetch card lockups
  const lockupsQuery = trpc.lineup.lockups.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Optimize mutation
  const optimizeMutation = trpc.lineup.optimize.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Built ${data.lineups.length} lineup${data.lineups.length > 1 ? "s" : ""} for ${data.contestName}`
      );
    },
    onError: (err) => {
      toast.error(`Optimization failed: ${err.message}`);
    },
  });

  // Save lineup mutation
  const saveLineupMutation = trpc.lineup.saveLineup.useMutation({
    onSuccess: (data) => {
      toast.success(data.updated ? "Lineup updated" : "Lineup saved");
    },
    onError: (err) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });

  const selectedContest = useMemo(() => {
    if (!selectedContestId || !contestsQuery.data) return null;
    return contestsQuery.data.contests.find((c) => c.id === selectedContestId);
  }, [selectedContestId, contestsQuery.data]);

  const handleOptimize = () => {
    if (!selectedContestId) {
      toast.error("Please select a contest first");
      return;
    }
    optimizeMutation.mutate({ contestId: selectedContestId, numEntries });
  };

  const handleSaveLineup = (lineup: any, entryNumber: number) => {
    if (!selectedContestId) return;
    saveLineupMutation.mutate({
      contestId: selectedContestId,
      entryNumber,
      champion1TokenId: lineup.champions[0]?.champion.tokenId ?? "",
      champion2TokenId: lineup.champions[1]?.champion.tokenId ?? "",
      champion3TokenId: lineup.champions[2]?.champion.tokenId ?? "",
      champion4TokenId: lineup.champions[3]?.champion.tokenId ?? "",
      schemeTokenId: lineup.schemeTokenId,
      predictedScore: lineup.predictedScore,
      status: "draft",
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gold">Lineup Builder</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build optimal lineups for upcoming contests
          </p>
        </div>
        <Card className="glass-card border-gold/20">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Lock className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground">Please log in and set your wallet address in Settings to use the Lineup Builder.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gold">Lineup Builder</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build optimal lineups for contests using your owned cards
          </p>
        </div>
      </div>

      {/* Budget & Inventory Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Gem className="w-4 h-4 text-teal" />
              Gem Budget
            </div>
            <div className="text-xl font-bold text-foreground">
              {budgetQuery.data ? (
                <>
                  <span className="text-teal">{budgetQuery.data.remaining.toLocaleString()}</span>
                  <span className="text-muted-foreground text-sm font-normal">
                    {" "}/ {budgetQuery.data.dailyBudget.toLocaleString()}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Swords className="w-4 h-4 text-gold" />
              MOKIs Owned
            </div>
            <div className="text-xl font-bold text-foreground">
              {inventoryQuery.data?.totalMokis ?? "—"}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Sparkles className="w-4 h-4 text-rarity-epic" />
              Schemes Owned
            </div>
            <div className="text-xl font-bold text-foreground">
              {inventoryQuery.data?.totalSchemes ?? "—"}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Lock className="w-4 h-4 text-destructive" />
              Cards Locked
            </div>
            <div className="text-xl font-bold text-foreground">
              {lockupsQuery.data?.length ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contest Selection */}
      <Card className="glass-card border-gold/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5 text-gold" />
            Select Contest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Filter */}
          <div className="flex gap-2">
            {["LIVE", "OPEN", "DRAFT"].map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setStatusFilter(status);
                  setSelectedContestId(null);
                }}
                className={statusFilter === status ? "bg-gold text-background" : ""}
              >
                {status === "DRAFT" ? "Upcoming" : status}
              </Button>
            ))}
          </div>

          {/* Contest List */}
          {contestsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : contestsQuery.data?.contests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No {statusFilter.toLowerCase()} contests found.</p>
              <p className="text-xs mt-1">Try scraping contests from the Dashboard first.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {contestsQuery.data?.contests.map((contest) => (
                <div
                  key={contest.id}
                  onClick={() => setSelectedContestId(contest.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedContestId === contest.id
                      ? "border-gold bg-gold/10"
                      : "border-border hover:border-gold/40 hover:bg-card/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{contest.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {FORMAT_LABELS[contest.format] ?? contest.format}
                        </Badge>
                        {contest.rarityRestriction && contest.rarityRestriction !== "OPEN" && (
                          <Badge className={`text-xs ${RARITY_BG[contest.rarityRestriction.replace("_ONLY", "")] ?? "bg-muted"}`}>
                            {contest.rarityRestriction.replace(/_/g, " ")}
                          </Badge>
                        )}
                        {contest.isOneOfEach && (
                          <Badge className="text-xs bg-teal/20 text-teal">1-of-Each</Badge>
                        )}
                        {contest.isStarCap && (
                          <Badge className="text-xs bg-rarity-legendary/20 text-rarity-legendary">Star Cap</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Gem className="w-3 h-3" />
                          {contest.entryFee ?? 0} gems
                        </span>
                        <span className="flex items-center gap-1">
                          <Trophy className="w-3 h-3" />
                          {Number(contest.prizePool ?? 0).toLocaleString()} prize
                        </span>
                        <span>
                          {contest.entries ?? 0}/{contest.maxEntries ?? "∞"} entries
                        </span>
                        <span>Max {contest.maxEntriesPerUser ?? 1}/user</span>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${selectedContestId === contest.id ? "text-gold rotate-90" : "text-muted-foreground"}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Optimizer Controls */}
      {selectedContest && (
        <Card className="glass-card border-teal/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-teal" />
              Build Lineups for: {selectedContest.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground mb-1 block">
                  Number of Entries
                </label>
                <Select
                  value={String(numEntries)}
                  onValueChange={(v) => setNumEntries(Number(v))}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      { length: selectedContest.maxEntriesPerUser ?? 1 },
                      (_, i) => i + 1
                    ).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === 1 ? "entry" : "entries"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-right">
                <div className="text-sm text-muted-foreground">Estimated Cost</div>
                <div className="text-lg font-bold text-teal">
                  {((selectedContest.entryFee ?? 0) * numEntries).toLocaleString()} gems
                </div>
                <div className="text-xs text-muted-foreground">
                  (${(((selectedContest.entryFee ?? 0) * numEntries) / 100).toFixed(2)} USD)
                </div>
              </div>

              <Button
                onClick={handleOptimize}
                disabled={optimizeMutation.isPending}
                className="bg-gold text-background hover:bg-gold/90 h-12 px-6"
              >
                {optimizeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Optimize Lineups
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Optimization Results */}
      {optimizeMutation.data && (
        <div className="space-y-4">
          {/* Warnings */}
          {optimizeMutation.data.warnings.length > 0 && (
            <Card className="glass-card border-destructive/30">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {optimizeMutation.data.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-destructive">
                        {w}
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">{optimizeMutation.data.totalEntries}</strong> lineups built
            </span>
            <span>
              Total cost: <strong className="text-teal">{optimizeMutation.data.gemCost.toLocaleString()}</strong> gems
            </span>
            <span>
              Remaining budget: <strong className="text-teal">{optimizeMutation.data.remainingBudget.toLocaleString()}</strong>
            </span>
          </div>

          {/* Lineup Cards */}
          {optimizeMutation.data.lineups.map((lineup, idx) => (
            <Card key={idx} className="glass-card border-gold/20">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="w-4 h-4 text-gold" />
                    Entry #{lineup.entryNumber}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      Predicted: <strong className="text-gold">{lineup.predictedScore.toLocaleString()}</strong> pts
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveLineup(lineup, lineup.entryNumber)}
                      disabled={saveLineupMutation.isPending}
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-3">
                  {/* 4 Champions */}
                  {lineup.champions.map((slot, ci) => (
                    <div
                      key={ci}
                      className="p-3 rounded-lg border border-border bg-card/50 text-center"
                    >
                      <div className="flex items-center justify-center mb-2">
                        <Shield className={`w-6 h-6 ${RARITY_COLORS[slot.champion.rarity] ?? "text-muted-foreground"}`} />
                      </div>
                      <div className="text-xs font-medium truncate" title={slot.champion.name}>
                        {slot.champion.name}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] mt-1 ${RARITY_COLORS[slot.champion.rarity] ?? ""}`}
                      >
                        {slot.champion.rarity}
                      </Badge>
                      <div className="text-xs text-muted-foreground mt-1">
                        {slot.score.toLocaleString()} pts
                      </div>
                    </div>
                  ))}

                  {/* Scheme Card */}
                  <div className="p-3 rounded-lg border border-teal/30 bg-teal/5 text-center">
                    <div className="flex items-center justify-center mb-2">
                      <Sparkles className="w-6 h-6 text-teal" />
                    </div>
                    <div className="text-xs font-medium truncate" title={lineup.scheme?.name ?? "No Scheme"}>
                      {lineup.scheme?.name ?? "No Scheme"}
                    </div>
                    <Badge variant="outline" className="text-[10px] mt-1 text-teal">
                      Scheme
                    </Badge>
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
