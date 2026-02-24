/**
 * Winning Lineups — AI-identified winning lineup combinations from completed contests.
 * Grouped by contest with top-10 accordion, larger card images, names, rules, payout, owned/buy.
 * Shows marketplace price + craft-vs-buy comparison for non-Basic cards.
 */

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trophy, Sparkles, Crown, Loader2, ChevronDown, ShoppingCart, Hammer } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";

// ─── Constants ─────────────────────────────────────────────────────

const RARITY_OPTIONS = [
  { value: "all", label: "All Contest Types" },
  { value: "OPEN", label: "Open" },
  { value: "COMMON_ONLY", label: "Common Only" },
  { value: "RARE_ONLY", label: "Rare Only" },
  { value: "EPIC_ONLY", label: "Epic Only" },
  { value: "LEGENDARY_ONLY", label: "Legendary Only" },
  { value: "ONE_OF_EACH", label: "One-Of-Each" },
  { value: "NO_LEGENDARY", label: "No Legendary" },
];

const FORMAT_OPTIONS = [
  { value: "all", label: "All Formats" },
  { value: "FIFTY_FIFTY", label: "50/50" },
  { value: "TOP_20_PCT", label: "Top 20%" },
  { value: "FREE_ENTRY", label: "Free Entry" },
];

// Crafting ratios
const BASICS_PER_RARE = 3;
const RARES_PER_EPIC = 10;
const EPICS_PER_LEGENDARY = 8;

// Gem to USD: 100 gems = $1
function gemsToUSD(gems: number): string {
  return `$${(gems / 100).toFixed(2)}`;
}

function formatPayout(payout: string | number | null): string {
  const val = Number(payout ?? 0);
  if (val <= 0) return "";
  return `$${val.toFixed(2)}`;
}

function formatRON(ron: number | null | undefined): string {
  if (ron == null) return "—";
  return `${ron.toFixed(2)} RON`;
}

function formatContestRules(contest: any): string[] {
  const rules: string[] = [];
  const fmt = contest.contestFormat === "FIFTY_FIFTY" ? "50/50" :
    contest.contestFormat === "TOP_20_PCT" ? "Top 20%" :
    contest.contestFormat === "FREE_ENTRY" ? "Free Entry" : contest.contestFormat;
  rules.push(fmt);

  if (contest.rarityRestriction && contest.rarityRestriction !== "OPEN") {
    rules.push(contest.rarityRestriction.replace(/_/g, " "));
  }
  if (contest.isOneOfEach) rules.push("One-Of-Each");
  if (contest.isStarCap) rules.push("Star Cap");
  if (contest.entryFee) rules.push(`Entry: ${contest.entryFee} gems`);
  if (contest.prizePool && Number(contest.prizePool) > 0) {
    // prizePool from GA API is in USD
    rules.push(`Prize Pool: $${Number(contest.prizePool).toFixed(2)} USD`);
  }
  return rules;
}

/**
 * Calculate crafting cost for a target rarity given floor prices.
 * Returns null if ingredients aren't available on marketplace.
 */
function getCraftingCost(
  targetRarity: string,
  prices: Record<string, number | null>
): { cost: number; ingredientRarity: string; ingredientCount: number; label: string } | null {
  switch (targetRarity) {
    case "Rare": {
      const basicPrice = prices["Basic"];
      if (basicPrice == null) return null;
      return {
        cost: basicPrice * BASICS_PER_RARE,
        ingredientRarity: "Basic",
        ingredientCount: BASICS_PER_RARE,
        label: `Craft: ${BASICS_PER_RARE} Basic`,
      };
    }
    case "Epic": {
      const rarePrice = prices["Rare"];
      if (rarePrice == null) return null;
      return {
        cost: rarePrice * RARES_PER_EPIC,
        ingredientRarity: "Rare",
        ingredientCount: RARES_PER_EPIC,
        label: `Craft: ${RARES_PER_EPIC} Rare`,
      };
    }
    case "Legendary": {
      const epicPrice = prices["Epic"];
      if (epicPrice == null) return null;
      return {
        cost: epicPrice * EPICS_PER_LEGENDARY,
        ingredientRarity: "Epic",
        ingredientCount: EPICS_PER_LEGENDARY,
        label: `Craft: ${EPICS_PER_LEGENDARY} Epic`,
      };
    }
    default:
      return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────

interface ChampionCard {
  name: string;
  championTokenId: string;
  rarity: string;
  confidence: number;
}

interface LineupEntry {
  entryId: number;
  rank: number;
  score: number;
  identifiedChampions: ChampionCard[];
  identifiedScheme: string | null;
  aiConfidence: string | null;
  cardImages: string[];
  estimatedPayout: string | null;
}

interface ContestGroup {
  contestId: string;
  contestName: string;
  contestFormat: string;
  contestDescription: string | null;
  rarityRestriction: string | null;
  prizePool: string | null;
  entryFee: number | null;
  isStarCap: boolean | null;
  isOneOfEach: boolean | null;
  scoringMethod: string | null;
  entries: LineupEntry[];
}

type PriceMap = Record<string, Record<string, number | null>>;

// ─── Main Component ────────────────────────────────────────────────

export default function WinningLineups() {
  const [rarity, setRarity] = useState("all");
  const [format, setFormat] = useState("all");
  const { user } = useAuth();

  const { data, isLoading } = trpc.contests.winningLineups.useQuery({
    rarityRestriction: rarity === "all" ? undefined : rarity,
    format: format === "all" ? undefined : format,
    limit: 50,
  });

  // Fetch user's owned cards for owned/buy check
  const { data: inventory } = trpc.lineup.inventory.useQuery(undefined, {
    enabled: !!user,
  });

  // Collect unique champion names from all visible lineups for batch price lookup
  const uniqueChampionNames = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const contest of data as ContestGroup[]) {
      for (const entry of contest.entries) {
        const champs = Array.isArray(entry.identifiedChampions) ? entry.identifiedChampions : [];
        for (const c of champs) {
          // Only fetch prices for non-Basic cards (Basic can't be crafted, only bought)
          if (c.name && c.rarity !== "Basic") {
            names.add(c.name);
          }
        }
      }
    }
    return Array.from(names);
  }, [data]);

  // Batch fetch floor prices for all champions
  const { data: priceData } = trpc.getBatchFloorPrices.useQuery(
    { championNames: uniqueChampionNames },
    { enabled: uniqueChampionNames.length > 0, staleTime: 5 * 60 * 1000 }
  );

  const priceMap: PriceMap = priceData?.prices ?? {};

  // Build ownership lookup: "championTokenId:rarity" → true
  const ownedSet = useMemo(() => {
    const set = new Set<string>();
    if (inventory?.mokis) {
      for (const card of inventory.mokis) {
        if (card.championTokenId && card.rarity) {
          set.add(`${card.championTokenId}:${card.rarity}`);
        }
      }
    }
    return set;
  }, [inventory]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Winning Lineups</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI-identified champion combinations from top contest placements
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={rarity} onValueChange={setRarity}>
          <SelectTrigger className="w-full sm:w-48 glass-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RARITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="w-full sm:w-40 glass-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      ) : data && data.length > 0 ? (
        <div className="space-y-6">
          {(data as ContestGroup[]).map((contest) => (
            <ContestCard
              key={contest.contestId}
              contest={contest}
              ownedSet={ownedSet}
              priceMap={priceMap}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="mb-2">No identified winning lineups yet.</p>
          <p className="text-sm">
            Run the contest scraper and AI identification from the Dashboard to populate this data.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Contest Card (groups all entries for one contest) ──────────────

function ContestCard({ contest, ownedSet, priceMap }: { contest: ContestGroup; ownedSet: Set<string>; priceMap: PriceMap }) {
  const [expanded, setExpanded] = useState(false);
  const topEntry = contest.entries[0];
  const otherEntries = contest.entries.slice(1);
  const rules = formatContestRules(contest);

  if (!topEntry) return null;

  return (
    <Card className="glass-card overflow-hidden">
      <CardContent className="p-5">
        {/* Contest Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Crown className="w-5 h-5 text-gold shrink-0" />
              <h2 className="text-lg font-bold text-foreground">{contest.contestName}</h2>
            </div>
            {/* Contest Rules */}
            <div className="flex flex-wrap gap-1.5 mt-1">
              {rules.map((rule, i) => (
                <Badge key={i} variant="outline" className="text-xs text-muted-foreground">
                  {rule}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Top Winning Lineup (#1) */}
        <LineupRow entry={topEntry} ownedSet={ownedSet} isTop={true} priceMap={priceMap} />

        {/* Accordion for ranks 2-10 */}
        {otherEntries.length > 0 && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="w-full flex items-center justify-center gap-2 py-2 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors border-t border-border/30 cursor-pointer">
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Hide" : `Show ${otherEntries.length} more lineup${otherEntries.length > 1 ? "s" : ""}`}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-3">
              {otherEntries.map((entry) => (
                <LineupRow key={entry.entryId} entry={entry} ownedSet={ownedSet} isTop={false} priceMap={priceMap} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Single Lineup Row ─────────────────────────────────────────────

function LineupRow({ entry, ownedSet, isTop, priceMap }: { entry: LineupEntry; ownedSet: Set<string>; isTop: boolean; priceMap: PriceMap }) {
  const champions = Array.isArray(entry.identifiedChampions) ? entry.identifiedChampions : [];
  const cardImages = Array.isArray(entry.cardImages) ? entry.cardImages : [];
  const confidence = Number(entry.aiConfidence ?? 0);
  const payoutStr = formatPayout(entry.estimatedPayout);

  return (
    <div className={`${isTop ? "" : "pt-4 border-t border-border/20"}`}>
      {/* Rank + Score + Payout header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            entry.rank === 1 ? "bg-gold/20" : "bg-muted/30"
          }`}>
            <span className={`text-xs font-bold ${entry.rank === 1 ? "text-gold" : "text-muted-foreground"}`}>
              #{entry.rank}
            </span>
          </div>
          <span className="text-gold font-bold text-sm">{entry.score.toLocaleString()} pts</span>
          {payoutStr && (
            <span className="text-xs text-muted-foreground ml-2">{payoutStr} payout</span>
          )}
        </div>
        <span className={`text-xs ${confidence >= 0.8 ? "text-green-400" : confidence >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
          {(confidence * 100).toFixed(0)}% confidence
        </span>
      </div>

      {/* Card Images with names, owned/buy, and pricing */}
      <div className="flex flex-wrap gap-4 mb-2">
        {cardImages.map((url, i) => {
          // The last image is always the scheme card (5th card = scheme)
          const isSchemeCard = i === cardImages.length - 1 && cardImages.length === 5;
          // Map champion data: champions array has 4 entries (indices 0-3), scheme card is index 4
          const champ = !isSchemeCard ? champions[i] : undefined;
          const isOwned = champ ? ownedSet.has(`${champ.championTokenId}:${champ.rarity}`) : false;
          const rarityLower = (champ?.rarity ?? "basic").toLowerCase();
          const champPrices = champ ? priceMap[champ.name] : null;

          return (
            <ChampionCardSlot
              key={i}
              url={url}
              champ={champ}
              isSchemeCard={isSchemeCard}
              isOwned={isOwned}
              rarityLower={rarityLower}
              schemeName={entry.identifiedScheme}
              champPrices={champPrices ?? null}
              isUnidentified={!isSchemeCard && !champ}
            />
          );
        })}
      </div>

      {/* Scheme card label */}
      {entry.identifiedScheme && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <Sparkles className="w-3 h-3 text-gold" />
          Scheme: <strong className="text-foreground">{entry.identifiedScheme}</strong>
        </div>
      )}
    </div>
  );
}

// ─── Individual Champion Card Slot ─────────────────────────────────

function ChampionCardSlot({
  url,
  champ,
  isSchemeCard,
  isOwned,
  rarityLower,
  schemeName,
  champPrices,
  isUnidentified = false,
}: {
  url: string;
  champ: ChampionCard | undefined;
  isSchemeCard: boolean;
  isOwned: boolean;
  rarityLower: string;
  schemeName: string | null;
  champPrices: Record<string, number | null> | null;
  isUnidentified?: boolean;
}) {
  // Calculate marketplace price and crafting cost for this specific rarity
  const marketPrice = champ && champPrices ? champPrices[champ.rarity] : null;
  const craftInfo = champ && champPrices && champ.rarity !== "Basic"
    ? getCraftingCost(champ.rarity, champPrices)
    : null;
  const craftIsCheaper = craftInfo && marketPrice != null && craftInfo.cost < marketPrice;

  return (
    <div className="flex flex-col items-center gap-1 w-[100px]">
      {/* Owned / Buy label above card */}
      {champ && (
        isOwned ? (
          <div className="text-xs font-semibold px-2 py-0.5 rounded text-green-400 bg-green-400/10">
            Owned
          </div>
        ) : (
          <Link
            href={`/card-crafter?champion=${encodeURIComponent(champ.name)}&rarity=${champ.rarity}`}
            className="text-xs font-semibold px-2 py-0.5 rounded text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 transition-colors cursor-pointer"
          >
            Buy
          </Link>
        )
      )}
      {isSchemeCard && (
        <div className="text-xs font-semibold px-2 py-0.5 rounded text-gold bg-gold/10">
          SCHEME
        </div>
      )}
      {isUnidentified && (
        <div className="text-xs font-semibold px-2 py-0.5 rounded text-muted-foreground bg-muted/20">
          Pending ID
        </div>
      )}

      {/* Marketplace price for Buy cards (non-Basic) */}
      {champ && !isOwned && champ.rarity !== "Basic" && marketPrice != null && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
          <ShoppingCart className="w-2.5 h-2.5" />
          {formatRON(marketPrice)}
        </div>
      )}

      {/* Craft price if cheaper */}
      {champ && !isOwned && craftInfo && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`/card-crafter?champion=${encodeURIComponent(champ.name)}&rarity=${champ.rarity}`}
              className={`text-[10px] flex items-center gap-0.5 cursor-pointer hover:underline ${
                craftIsCheaper ? "text-green-400 font-semibold" : "text-muted-foreground"
              }`}
            >
              <Hammer className="w-2.5 h-2.5" />
              {craftIsCheaper ? `Craft ${formatRON(craftInfo.cost)}` : `Craft ${formatRON(craftInfo.cost)}`}
              {craftIsCheaper && <span className="text-green-400">✓</span>}
            </Link>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[200px]">
            <p className="font-semibold mb-1">{craftInfo.label}</p>
            <p>Buy {craftInfo.ingredientCount}× {craftInfo.ingredientRarity} at {formatRON(champPrices?.[craftInfo.ingredientRarity] ?? null)} each</p>
            <p className="mt-1">Total craft cost: {formatRON(craftInfo.cost)}</p>
            {marketPrice != null && (
              <p className={craftIsCheaper ? "text-green-400 mt-1" : "text-amber-400 mt-1"}>
                {craftIsCheaper
                  ? `Save ${formatRON(marketPrice - craftInfo.cost)} vs buying directly`
                  : `Buying directly is ${formatRON(craftInfo.cost - marketPrice)} cheaper`}
              </p>
            )}
            <p className="mt-1 text-muted-foreground">Click to see full breakdown in Card Crafter</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Card image — 75% larger (from 48px to 84px) */}
      <img
        src={url}
        alt={champ?.name ?? `Card`}
        className={`w-[84px] h-[84px] rounded-lg object-cover border-2 ${
          isSchemeCard
            ? "border-gold/50"
            : `rarity-${rarityLower}`
        }`}
        loading="lazy"
      />

      {/* Name underneath */}
      <span className={`text-xs font-medium text-center max-w-[100px] leading-tight ${
        isSchemeCard ? "text-gold" : isUnidentified ? "text-muted-foreground italic" : `text-rarity-${rarityLower}`
      }`}>
        {champ?.name ?? schemeName ?? (isUnidentified ? "Pending ID" : "Unknown")}
      </span>

      {/* Rarity badge removed — was showing as colored bar below card */}
    </div>
  );
}
