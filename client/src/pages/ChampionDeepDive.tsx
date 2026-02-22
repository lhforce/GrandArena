/**
 * Champion Deep Dive — Full champion profile page
 * Shows performance stats, best/worst matchups, and marketplace prices for all rarities.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Swords,
  Target,
  Trophy,
  ShoppingCart,
  BarChart3,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

function StatBox({
  label,
  value,
  sub,
  color = "text-gold",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-white/4 border border-white/8">
      <span className="section-label">{label}</span>
      <span className={`text-2xl font-[Nunito] font-black ${color}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function RarityPriceBadge({
  rarity,
  price,
}: {
  rarity: string;
  price: number | null | undefined;
}) {
  const rarityColors: Record<string, string> = {
    Basic: "text-rarity-basic border-rarity-basic/30 bg-rarity-basic/10",
    Rare: "text-rarity-rare border-rarity-rare/30 bg-rarity-rare/10",
    Epic: "text-rarity-epic border-rarity-epic/30 bg-rarity-epic/10",
    Legendary: "text-rarity-legendary border-rarity-legendary/30 bg-rarity-legendary/10",
  };
  return (
    <div
      className={`flex flex-col items-center gap-1 p-3 rounded-xl border ${rarityColors[rarity] ?? "border-white/10"}`}
    >
      <span className="text-xs font-bold uppercase tracking-widest opacity-70">{rarity}</span>
      {price != null ? (
        <span className="text-sm font-[Nunito] font-black">{price.toFixed(2)} RON</span>
      ) : (
        <span className="text-xs text-muted-foreground">No listing</span>
      )}
    </div>
  );
}

export default function ChampionDeepDive() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChampion, setSelectedChampion] = useState<{
    championTokenId: number;
    name: string;
  } | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const debouncedQuery = useDebounce(searchQuery, 300);

  const searchResults = trpc.matchup.searchChampions.useQuery(
    { query: debouncedQuery, limit: 10 },
    { enabled: debouncedQuery.length >= 2 }
  );

  const deepDive = trpc.matchup.getChampionDeepDive.useQuery(
    { championTokenId: selectedChampion?.championTokenId ?? 0 },
    { enabled: !!selectedChampion }
  );

  const prices = trpc.matchup.getChampionPrices.useQuery(
    { championName: selectedChampion?.name ?? "" },
    { enabled: !!selectedChampion }
  );

  const handleSelectChampion = (champ: { championTokenId: number; championName: string }) => {
    setSelectedChampion({ championTokenId: champ.championTokenId, name: champ.championName });
    setSearchQuery(champ.championName);
    setShowSearch(false);
  };

  const perf = deepDive.data?.performance;
  const matchups = deepDive.data?.matchups;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-[Nunito] font-black text-white">Champion Deep Dive</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full profile: stats, matchups, and marketplace prices for any champion.
        </p>
      </div>

      {/* Search */}
      <Card className="bg-card border-white/10">
        <CardContent className="pt-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search champion name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
              className="pl-9 bg-white/4 border-white/10 font-[Nunito] font-semibold"
            />
            {/* Dropdown */}
            {showSearch && debouncedQuery.length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                {searchResults.isLoading ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : searchResults.data?.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No champions found</div>
                ) : (
                  searchResults.data?.map((champ) => (
                    <button
                      key={champ.championTokenId}
                      onClick={() => handleSelectChampion(champ)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/6 transition-colors text-left"
                    >
                      <div>
                        <span className="text-sm font-[Nunito] font-bold text-white">
                          {champ.championName}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {champ.championClass}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {deepDive.isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      )}

      {/* No data */}
      {selectedChampion && !deepDive.isLoading && !deepDive.data && (
        <Card className="bg-card border-white/10">
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No match data found for this champion yet.</p>
          </CardContent>
        </Card>
      )}

      {/* Profile */}
      {perf && (
        <>
          {/* Champion header */}
          <div className="flex items-center gap-4">
            {deepDive.data?.imageUrl && (
              <img
                src={deepDive.data.imageUrl}
                alt={perf.championName}
                className="w-16 h-16 rounded-2xl border-2 border-gold/30 object-cover"
              />
            )}
            <div>
              <h2 className="text-3xl font-[Nunito] font-black text-white">{perf.championName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="border-lime/30 text-lime font-[Nunito] font-bold text-xs">
                  {perf.championClass}
                </Badge>
                <span className="text-xs text-muted-foreground">{perf.totalMatches} matches scraped</span>
              </div>
            </div>
          </div>

          {/* Performance stats */}
          <Card className="bg-card border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-[Nunito] font-black text-white flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-lime" />
                Performance Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatBox
                  label="Win Rate"
                  value={`${perf.winRate.toFixed(1)}%`}
                  sub={`${perf.wins}W / ${perf.losses}L`}
                  color={perf.winRate >= 50 ? "text-lime" : "text-pink"}
                />
                <StatBox
                  label="Avg Score"
                  value={perf.avgEstimatedScore.toFixed(0)}
                  sub="pts estimated"
                  color="text-gold"
                />
                <StatBox
                  label="Avg Kills"
                  value={perf.avgKills.toFixed(2)}
                  sub="per match"
                  color="text-teal"
                />
                <StatBox
                  label="Avg Balls"
                  value={perf.avgBalls.toFixed(2)}
                  sub="per match"
                  color="text-teal"
                />
                <StatBox
                  label="Avg Wart"
                  value={perf.avgWartDistance.toFixed(0)}
                  sub="distance"
                  color="text-teal"
                />
                <StatBox
                  label="Elim Wins"
                  value={perf.eliminationWins}
                  sub={`${perf.wartWins} wart / ${perf.gachaWins} gacha`}
                  color="text-purple"
                />
              </div>
            </CardContent>
          </Card>

          {/* Best & Worst Matchups */}
          {matchups && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Best matchups */}
              <Card className="bg-card border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-[Nunito] font-black text-white flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-lime" />
                    Best Matchups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {matchups.bestMatchups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Not enough data</p>
                  ) : (
                    <div className="space-y-2">
                      {matchups.bestMatchups.slice(0, 8).map((m) => (
                        <div
                          key={m.opponentTokenId}
                          className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/3 hover:bg-white/6 transition-colors"
                        >
                          <div>
                            <span className="text-sm font-[Nunito] font-bold text-white">
                              {m.opponentName}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.wins}W-{m.losses}L
                            </span>
                          </div>
                          <span className="text-sm font-[Nunito] font-black text-lime">
                            {m.winRate.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Worst matchups */}
              <Card className="bg-card border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-[Nunito] font-black text-white flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-pink" />
                    Tough Matchups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {matchups.worstMatchups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Not enough data</p>
                  ) : (
                    <div className="space-y-2">
                      {matchups.worstMatchups.slice(0, 8).map((m) => (
                        <div
                          key={m.opponentTokenId}
                          className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/3 hover:bg-white/6 transition-colors"
                        >
                          <div>
                            <span className="text-sm font-[Nunito] font-bold text-white">
                              {m.opponentName}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.wins}W-{m.losses}L
                            </span>
                          </div>
                          <span className="text-sm font-[Nunito] font-black text-pink">
                            {m.winRate.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Marketplace Prices */}
          <Card className="bg-card border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-[Nunito] font-black text-white flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-gold" />
                Marketplace Prices
                {prices.isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {prices.isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {["Basic", "Rare", "Epic", "Legendary"].map((r) => (
                    <div key={r} className="h-16 skeleton rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {["Basic", "Rare", "Epic", "Legendary"].map((rarity) => (
                    <RarityPriceBadge
                      key={rarity}
                      rarity={rarity}
                      price={prices.data?.[rarity] ?? null}
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Floor prices from Ronin Marketplace. Refresh the page to update.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty state */}
      {!selectedChampion && (
        <Card className="bg-card border-white/10">
          <CardContent className="py-16 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-[Nunito] font-black text-white mb-2">
              Search for a Champion
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Type a champion name above to view their full performance profile, matchup history, and marketplace prices.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
