/**
 * Contests — Browse all contests with filters for status, format, and rarity.
 * Mobile responsive.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Swords,
  Trophy,
  Users,
  Clock,
  Gem,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "LIVE", label: "Live" },
  { value: "OPEN", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DRAFT", label: "Draft" },
];

const FORMAT_OPTIONS = [
  { value: "all", label: "All Formats" },
  { value: "FIFTY_FIFTY", label: "50/50" },
  { value: "TOP_20_PCT", label: "Top 20%" },
  { value: "FREE_ENTRY", label: "Free Entry" },
];

const RARITY_OPTIONS = [
  { value: "all", label: "All Rarities" },
  { value: "OPEN", label: "Open" },
  { value: "COMMON_ONLY", label: "Common Only" },
  { value: "RARE_ONLY", label: "Rare Only" },
  { value: "EPIC_ONLY", label: "Epic Only" },
  { value: "LEGENDARY_ONLY", label: "Legendary Only" },
  { value: "ONE_OF_EACH", label: "One-Of-Each" },
  { value: "NO_LEGENDARY", label: "No Legendary" },
  { value: "BASIC_OR_RARE", label: "Basic or Rare" },
];

const PAGE_SIZE = 20;

export default function Contests() {
  const [status, setStatus] = useState("all");
  const [format, setFormat] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [offset, setOffset] = useState(0);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contests.list.useQuery({
    status: status === "all" ? undefined : status,
    format: format === "all" ? undefined : format,
    rarityRestriction: rarity === "all" ? undefined : rarity,
    limit: PAGE_SIZE,
    offset,
  });

  const refreshActive = trpc.contests.refreshActive.useMutation({
    onSuccess: (result) => {
      toast.success("Refreshed", { description: `Updated ${result.refreshed} active contests` });
      utils.contests.list.invalidate();
    },
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Contests</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {data?.total ?? 0} contests found
          </p>
        </div>
        <Button
          onClick={() => refreshActive.mutate()}
          disabled={refreshActive.isPending}
          variant="outline"
          className="border-teal/30 text-teal hover:bg-teal/10 h-10 self-start sm:self-auto"
        >
          {refreshActive.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1.5" />
          )}
          Refresh Active
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0); }}>
          <SelectTrigger className="glass-card h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={format} onValueChange={(v) => { setFormat(v); setOffset(0); }}>
          <SelectTrigger className="glass-card h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={rarity} onValueChange={(v) => { setRarity(v); setOffset(0); }}>
          <SelectTrigger className="glass-card col-span-2 sm:col-span-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RARITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Contest List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-3 sm:p-4">
                <div className="h-5 bg-muted rounded w-48 mb-2" />
                <div className="h-4 bg-muted rounded w-full max-w-sm" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.contests && data.contests.length > 0 ? (
        <div className="space-y-2 sm:space-y-3">
          {data.contests.map((contest) => (
            <ContestCard key={contest.id} contest={contest} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Swords className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No contests found. Adjust filters or scrape new data.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0} className="h-10 w-10 p-0">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={currentPage >= totalPages} className="h-10 w-10 p-0">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ContestCard({ contest }: { contest: any }) {
  const statusColor: Record<string, string> = {
    LIVE: "bg-green-500/20 text-green-300 border-green-500/30",
    OPEN: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    COMPLETED: "bg-muted text-muted-foreground",
    DRAFT: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  };
  const formatLabel: Record<string, string> = {
    FIFTY_FIFTY: "50/50", TOP_20_PCT: "Top 20%", FREE_ENTRY: "Free Entry",
  };
  const rarityLabel: Record<string, string> = {
    OPEN: "Open", COMMON_ONLY: "Common", RARE_ONLY: "Rare", EPIC_ONLY: "Epic",
    LEGENDARY_ONLY: "Legendary", ONE_OF_EACH: "1-of-Each", NO_LEGENDARY: "No Leg.", BASIC_OR_RARE: "Basic/Rare",
  };

  const entryFeeGems = contest.entryFee ?? 0;
  const prizePoolGems = Number(contest.prizePool ?? 0);
  const spotsLeft = (contest.maxEntries ?? 0) - (contest.entries ?? 0);

  return (
    <Card className="glass-card hover:border-gold/20 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-sm sm:text-base truncate max-w-[200px] sm:max-w-none">{contest.name}</h3>
              <Badge className={`text-[10px] sm:text-xs ${statusColor[contest.contestStatus] ?? "bg-muted"}`}>
                {contest.contestStatus}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground mt-1.5">
              <span className="flex items-center gap-1">
                <Trophy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                {formatLabel[contest.format] ?? contest.format}
              </span>
              {contest.rarityRestriction && contest.rarityRestriction !== "OPEN" && (
                <Badge variant="outline" className="text-[10px] sm:text-xs h-5">
                  {rarityLabel[contest.rarityRestriction] ?? contest.rarityRestriction}
                </Badge>
              )}
              {contest.isStarCap && (
                <Badge variant="outline" className="text-[10px] sm:text-xs border-gold/30 text-gold h-5">Star Cap</Badge>
              )}
              {contest.isOneOfEach && (
                <Badge variant="outline" className="text-[10px] sm:text-xs border-purple-400/30 text-purple-300 h-5">1-of-Each</Badge>
              )}
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                {contest.entries}/{contest.maxEntries}
                {spotsLeft > 0 && spotsLeft <= 20 && (
                  <span className="text-gold">({spotsLeft}!)</span>
                )}
              </span>
            </div>
          </div>
          <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-0 sm:text-right shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-border/30">
            <div className="flex items-center gap-1 text-gold font-semibold text-sm">
              <Gem className="w-3.5 h-3.5" />
              {prizePoolGems.toLocaleString()}
              <span className="text-[10px] text-muted-foreground font-normal ml-0.5">(${(prizePoolGems / 100).toFixed(0)})</span>
            </div>
            {entryFeeGems > 0 && (
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                Entry: {entryFeeGems}g
              </p>
            )}
            {contest.startDate && (
              <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(contest.startDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
