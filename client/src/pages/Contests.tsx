/**
 * Contests — Browse all contests with filters for status, format, and rarity.
 * Features:
 *  - Open contests with available slots appear first; full contests in collapsible "FULL" section
 *  - "Open Slots Only" toggle to filter to joinable contests
 *  - Countdown timer showing time until contest starts
 *  - Favorite/pin contests to the top with star icon (persisted in database)
 *  - Clicking an open contest navigates to the Lineup Builder
 */

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Swords,
  Trophy,
  Users,
  Clock,
  Gem,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  Zap,
  Ban,
  Star,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────

function isContestFull(contest: any): boolean {
  const maxE = contest.maxEntries;
  const currentEntries = contest.entries ?? 0;
  const isUnlimited = maxE === null || maxE === undefined || maxE === 0;
  return !isUnlimited && currentEntries >= maxE;
}

function isContestOpen(contest: any): boolean {
  return (
    (contest.contestStatus === "OPEN" || contest.contestStatus === "LIVE") &&
    !isContestFull(contest)
  );
}

function getSpotsLeft(contest: any): number {
  const maxE = contest.maxEntries;
  const currentEntries = contest.entries ?? 0;
  const isUnlimited = maxE === null || maxE === undefined || maxE === 0;
  return isUnlimited ? Infinity : maxE - currentEntries;
}

function getCountdown(startDate: string | Date | null | undefined): string | null {
  if (!startDate) return null;
  const start = new Date(startDate).getTime();
  const now = Date.now();
  const diff = start - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── Main Component ───────────────────────────────────────────────

export default function Contests() {
  const [status, setStatus] = useState("all");
  const [format, setFormat] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [offset, setOffset] = useState(0);
  const [fullOpen, setFullOpen] = useState(false);
  const [openSlotsOnly, setOpenSlotsOnly] = useState(false);
  const [, setTick] = useState(0);

  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();

  // Countdown timer — tick every second
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data, isLoading } = trpc.contests.list.useQuery({
    status: status === "all" ? undefined : status,
    format: format === "all" ? undefined : format,
    rarityRestriction: rarity === "all" ? undefined : rarity,
    limit: PAGE_SIZE,
    offset,
  });

  // Favorites — only fetch if authenticated
  const { data: favoriteIds = [] } = trpc.contests.getFavorites.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const toggleFavorite = trpc.contests.toggleFavorite.useMutation({
    onMutate: async ({ contestId }) => {
      await utils.contests.getFavorites.cancel();
      const prev = utils.contests.getFavorites.getData();
      utils.contests.getFavorites.setData(undefined, (old) => {
        if (!old) return [contestId];
        return old.includes(contestId)
          ? old.filter((id) => id !== contestId)
          : [...old, contestId];
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        utils.contests.getFavorites.setData(undefined, context.prev);
      }
      toast.error("Failed to update favorite");
    },
    onSettled: () => {
      utils.contests.getFavorites.invalidate();
    },
  });

  const refreshActive = trpc.contests.refreshActive.useMutation({
    onSuccess: (result) => {
      toast.success("Refreshed", {
        description: `Updated ${result.refreshed} active contests`,
      });
      utils.contests.list.invalidate();
    },
  });

  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // Split contests into available and full groups, with favorites pinned to top
  const { available, full, openSlotCount } = useMemo(() => {
    const all = data?.contests ?? [];
    const avail: typeof all = [];
    const fullList: typeof all = [];

    for (const c of all) {
      if (isContestFull(c)) {
        fullList.push(c);
      } else {
        avail.push(c);
      }
    }

    // Sort available: favorites first, then OPEN, then LIVE, then by spots remaining
    avail.sort((a, b) => {
      // Favorites always first
      const aFav = favSet.has(a.id) ? 0 : 1;
      const bFav = favSet.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      const statusOrder: Record<string, number> = { OPEN: 0, LIVE: 1, DRAFT: 2 };
      const sa = statusOrder[a.contestStatus] ?? 3;
      const sb = statusOrder[b.contestStatus] ?? 3;
      if (sa !== sb) return sa - sb;

      const spotsA = getSpotsLeft(a);
      const spotsB = getSpotsLeft(b);
      return spotsA - spotsB;
    });

    // Filter if openSlotsOnly is enabled
    const filtered = openSlotsOnly
      ? avail.filter((c) => isContestOpen(c))
      : avail;

    return {
      available: filtered,
      full: openSlotsOnly ? [] : fullList,
      openSlotCount: avail.filter((c) => isContestOpen(c)).length,
    };
  }, [data?.contests, favSet, openSlotsOnly]);

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const handleContestClick = useCallback(
    (contest: any) => {
      if (isContestOpen(contest)) {
        navigate(`/lineup-builder?contestId=${contest.id}`);
      }
    },
    [navigate]
  );

  const handleToggleFavorite = useCallback(
    (e: React.MouseEvent, contestId: number) => {
      e.stopPropagation();
      if (!isAuthenticated) {
        toast.error("Please log in to favorite contests");
        return;
      }
      toggleFavorite.mutate({ contestId });
    },
    [isAuthenticated, toggleFavorite]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">
            Contests
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {data?.total ?? 0} contests found
            {openSlotCount > 0 && (
              <span className="text-teal ml-1">
                ({openSlotCount} with open slots)
              </span>
            )}
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
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 items-center">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="glass-card h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={format}
          onValueChange={(v) => {
            setFormat(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="glass-card h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={rarity}
          onValueChange={(v) => {
            setRarity(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="glass-card col-span-2 sm:col-span-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RARITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Open Slots Only toggle */}
        <div className="col-span-2 sm:col-span-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-card/50">
          <Switch
            checked={openSlotsOnly}
            onCheckedChange={setOpenSlotsOnly}
            className="data-[state=checked]:bg-teal"
          />
          <label className="text-xs sm:text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap" onClick={() => setOpenSlotsOnly(!openSlotsOnly)}>
            Open Slots Only
          </label>
        </div>
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
          {/* Available contests (with open slots) */}
          {available.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onClick={() => handleContestClick(contest)}
              clickable={isContestOpen(contest)}
              isFavorite={favSet.has(contest.id)}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}

          {/* Full contests accordion */}
          {full.length > 0 && (
            <Collapsible open={fullOpen} onOpenChange={setFullOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors group cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Ban className="w-4 h-4 text-destructive" />
                    <span className="font-bold text-destructive text-sm sm:text-base tracking-wide">
                      FULL
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] sm:text-xs border-destructive/30 text-destructive"
                    >
                      {full.length} contest{full.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-destructive transition-transform duration-200 ${
                      fullOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 sm:space-y-3 mt-2 sm:mt-3">
                  {full.map((contest) => (
                    <ContestCard
                      key={contest.id}
                      contest={contest}
                      onClick={() => {}}
                      clickable={false}
                      isFavorite={favSet.has(contest.id)}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Swords className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">
            No contests found. Adjust filters or scrape new data.
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="h-10 w-10 p-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={currentPage >= totalPages}
            className="h-10 w-10 p-0"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Contest Card ─────────────────────────────────────────────────

function ContestCard({
  contest,
  onClick,
  clickable,
  isFavorite,
  onToggleFavorite,
}: {
  contest: any;
  onClick: () => void;
  clickable: boolean;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent, contestId: number) => void;
}) {
  const statusColor: Record<string, string> = {
    LIVE: "bg-green-500/20 text-green-300 border-green-500/30",
    OPEN: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    COMPLETED: "bg-muted text-muted-foreground",
    DRAFT: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  };
  const formatLabel: Record<string, string> = {
    FIFTY_FIFTY: "50/50",
    TOP_20_PCT: "Top 20%",
    FREE_ENTRY: "Free Entry",
  };
  const rarityLabel: Record<string, string> = {
    OPEN: "Open",
    COMMON_ONLY: "Common",
    RARE_ONLY: "Rare",
    EPIC_ONLY: "Epic",
    LEGENDARY_ONLY: "Legendary",
    ONE_OF_EACH: "1-of-Each",
    NO_LEGENDARY: "No Leg.",
    BASIC_OR_RARE: "Basic/Rare",
  };

  const entryFeeGems = contest.entryFee ?? 0;
  const prizePoolGems = Number(contest.prizePool ?? 0);
  const maxE = contest.maxEntries;
  const currentEntries = contest.entries ?? 0;
  const isUnlimited = maxE === null || maxE === undefined || maxE === 0;
  const isFull = !isUnlimited && currentEntries >= maxE;
  const spotsLeft = isUnlimited ? Infinity : maxE - currentEntries;

  const countdown = getCountdown(contest.startDate);
  const isStartingSoon = countdown !== null;

  return (
    <Card
      className={`glass-card transition-colors ${
        isFavorite ? "border-gold/30 " : ""
      }${
        clickable
          ? "hover:border-teal/40 cursor-pointer group"
          : isFull
          ? "opacity-70 border-destructive/15"
          : "hover:border-gold/20"
      }`}
      onClick={clickable ? onClick : undefined}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {/* Favorite star */}
              <button
                onClick={(e) => onToggleFavorite(e, contest.id)}
                className={`shrink-0 p-0.5 rounded transition-colors ${
                  isFavorite
                    ? "text-gold hover:text-gold/70"
                    : "text-muted-foreground/30 hover:text-gold/50"
                }`}
                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  className={`w-4 h-4 ${isFavorite ? "fill-gold" : ""}`}
                />
              </button>
              <h3 className="font-semibold text-sm sm:text-base truncate max-w-[200px] sm:max-w-none">
                {contest.name}
              </h3>
              <Badge
                className={`text-[10px] sm:text-xs ${
                  statusColor[contest.contestStatus] ?? "bg-muted"
                }`}
              >
                {contest.contestStatus}
              </Badge>
              {isFull && (
                <Badge className="text-[10px] sm:text-xs bg-destructive/20 text-destructive border-destructive/30">
                  FULL
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground mt-1.5">
              <span className="flex items-center gap-1">
                <Trophy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                {formatLabel[contest.format] ?? contest.format}
              </span>
              {contest.rarityRestriction &&
                contest.rarityRestriction !== "OPEN" && (
                  <Badge variant="outline" className="text-[10px] sm:text-xs h-5">
                    {rarityLabel[contest.rarityRestriction] ??
                      contest.rarityRestriction}
                  </Badge>
                )}
              {contest.isStarCap && (
                <Badge
                  variant="outline"
                  className="text-[10px] sm:text-xs border-gold/30 text-gold h-5"
                >
                  Star Cap
                </Badge>
              )}
              {contest.isOneOfEach && (
                <Badge
                  variant="outline"
                  className="text-[10px] sm:text-xs border-purple-400/30 text-purple-300 h-5"
                >
                  1-of-Each
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                {currentEntries}/{isUnlimited ? "\u221E" : maxE}
                {!isFull && spotsLeft > 0 && spotsLeft <= 20 ? (
                  <span className="text-gold">({spotsLeft} left)</span>
                ) : null}
              </span>
            </div>
          </div>
          <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-0 sm:text-right shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-border/30">
            <div className="flex items-center gap-1 text-gold font-semibold text-sm">
              <Gem className="w-3.5 h-3.5" />
              {prizePoolGems.toLocaleString()}
              <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                (${(prizePoolGems / 100).toFixed(0)})
              </span>
            </div>
            {entryFeeGems > 0 && (
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                Entry: {entryFeeGems}g
              </p>
            )}
            {/* Countdown timer */}
            {isStartingSoon && (
              <p className="text-[10px] sm:text-xs font-medium text-teal flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Starts in {countdown}
              </p>
            )}
            {/* Fallback: show date if no countdown */}
            {!isStartingSoon && contest.startDate && (
              <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(contest.startDate).toLocaleDateString()}
              </p>
            )}
            {clickable && (
              <div className="hidden sm:flex items-center gap-1 text-teal text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Zap className="w-3 h-3" />
                Build Lineup
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
