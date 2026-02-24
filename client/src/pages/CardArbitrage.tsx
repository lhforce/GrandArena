/**
 * Card Arbitrage — Profit-focused marketplace analysis page.
 *
 * Two tabs:
 * 1. Craft Arbitrage: Buy low rarity → craft up → sell high
 * 2. Supply Squeeze: Low-supply cards for buyout/relist plays
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Lock, RefreshCw, DollarSign, ArrowRight, ExternalLink, Clock } from "lucide-react";
import { toast } from "sonner";

type Tab = "craft" | "squeeze";
type RarityFilter = "all" | "Rare" | "Epic" | "Legendary";
type SortField = "profitPercent" | "profitUsd" | "cardsNeeded" | "sellPriceUsd";

export default function CardArbitrage() {
  const [activeTab, setActiveTab] = useState<Tab>("craft");
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [sortBy, setSortBy] = useState<SortField>("profitPercent");

  // Fetch data
  const oppsQuery = trpc.arbitrage.getOpportunities.useQuery(undefined, {
    refetchInterval: 10_000, // Poll every 10s during scan
  });
  const squeezeQuery = trpc.arbitrage.getSqueezeOpportunities.useQuery();
  const overviewQuery = trpc.arbitrage.getOverview.useQuery();
  const ratesQuery = trpc.arbitrage.getExchangeRates.useQuery();
  const triggerScan = trpc.arbitrage.triggerScan.useMutation({
    onSuccess: () => toast.success("Arbitrage scan started — this takes a few minutes"),
    onError: (err) => toast.error(err.message),
  });

  // Filter & sort craft opportunities
  const craftOpps = useMemo(() => {
    let items = oppsQuery.data?.opportunities || [];
    if (rarityFilter !== "all") {
      items = items.filter((o) => o.targetRarity === rarityFilter);
    }
    return [...items].sort((a, b) => {
      if (sortBy === "profitPercent") return b.profitPercent - a.profitPercent;
      if (sortBy === "profitUsd") return b.profitUsd - a.profitUsd;
      if (sortBy === "cardsNeeded") return a.cardsNeeded - b.cardsNeeded;
      if (sortBy === "sellPriceUsd") return b.sellPriceUsd - a.sellPriceUsd;
      return 0;
    });
  }, [oppsQuery.data, rarityFilter, sortBy]);

  const squeezeOpps = squeezeQuery.data?.opportunities || [];
  const scanInProgress = oppsQuery.data?.scanInProgress || false;
  const scanProgress = oppsQuery.data?.scanProgress;
  const lastScanAt = oppsQuery.data?.lastScanAt;

  const rarityColor = (r: string) => {
    switch (r) {
      case "Basic": return "bg-gray-600 text-gray-100";
      case "Rare": return "bg-green-700 text-green-100";
      case "Epic": return "bg-purple-700 text-purple-100";
      case "Legendary": return "bg-pink-700 text-pink-100";
      default: return "bg-gray-600 text-gray-100";
    }
  };

  const profitColor = (pct: number) => {
    if (pct >= 50) return "text-green-400 font-bold";
    if (pct >= 20) return "text-yellow-400 font-semibold";
    if (pct > 0) return "text-orange-400";
    return "text-red-400";
  };

  const GA_CONTRACT = '0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b';
  const marketplaceUrl = (name: string, rarity: string) =>
    `https://marketplace.roninchain.com/collections/${GA_CONTRACT}?Rarity=${encodeURIComponent(rarity)}&search=${encodeURIComponent(name.toLowerCase())}`;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: "oklch(0.78 0.16 85)" }}>
            Card Arbitrage
          </h1>
          <p className="text-muted-foreground mt-1">
            Profit-focused marketplace analysis — craft low, sell high
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scanInProgress && scanProgress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning {scanProgress.current}/{scanProgress.total}
            </div>
          )}
          <Button
            onClick={() => triggerScan.mutate()}
            disabled={scanInProgress || triggerScan.isPending}
            variant="outline"
            className="border-yellow-600/50 hover:bg-yellow-600/10"
          >
            {scanInProgress ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning...</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" /> Scan Marketplace</>
            )}
          </Button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Craft Opportunities
            </div>
            <div className="text-2xl font-bold mt-1">{craftOpps.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="w-3 h-3" /> Supply Squeezes
            </div>
            <div className="text-2xl font-bold mt-1">{squeezeOpps.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> RON Price
            </div>
            <div className="text-2xl font-bold mt-1">
              ${ratesQuery.data?.ronUsd?.toFixed(4) || "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Last Scan
            </div>
            <div className="text-sm font-medium mt-1">
              {lastScanAt ? new Date(lastScanAt).toLocaleTimeString() : "Never"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border/50 pb-2">
        <Button
          variant={activeTab === "craft" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("craft")}
          className={activeTab === "craft" ? "bg-yellow-600 hover:bg-yellow-700" : ""}
        >
          <TrendingUp className="w-4 h-4 mr-1" /> Craft Arbitrage
        </Button>
        <Button
          variant={activeTab === "squeeze" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("squeeze")}
          className={activeTab === "squeeze" ? "bg-yellow-600 hover:bg-yellow-700" : ""}
        >
          <Lock className="w-4 h-4 mr-1" /> Supply Squeeze
        </Button>
      </div>

      {/* Craft Arbitrage Tab */}
      {activeTab === "craft" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <Select value={rarityFilter} onValueChange={(v) => setRarityFilter(v as RarityFilter)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Target Rarity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Rarities</SelectItem>
                <SelectItem value="Rare">Rare</SelectItem>
                <SelectItem value="Epic">Epic</SelectItem>
                <SelectItem value="Legendary">Legendary</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profitPercent">Profit %</SelectItem>
                <SelectItem value="profitUsd">Profit USD</SelectItem>
                <SelectItem value="cardsNeeded">Cards Needed</SelectItem>
                <SelectItem value="sellPriceUsd">Sell Price</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-sm text-muted-foreground ml-auto">
              {craftOpps.length} opportunities
            </span>
          </div>

          {/* Table */}
          {oppsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : craftOpps.length === 0 ? (
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-8 text-center text-muted-foreground">
                <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-lg font-medium">No craft arbitrage opportunities found</p>
                <p className="text-sm mt-1">Click "Scan Marketplace" to fetch live data</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[180px]">Champion</TableHead>
                    <TableHead className="text-center">Path</TableHead>
                    <TableHead className="text-right">Buy Cost</TableHead>
                    <TableHead className="text-right">Sell Price</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Profit %</TableHead>
                    <TableHead className="text-center">Supply</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {craftOpps.slice(0, 50).map((opp, i) => (
                    <TableRow key={`${opp.championName}-${opp.sourceRarity}-${opp.targetRarity}`} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{opp.championName}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Badge variant="outline" className={`text-xs ${rarityColor(opp.sourceRarity)}`}>
                            {opp.cardsNeeded}× {opp.sourceRarity}
                          </Badge>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <Badge variant="outline" className={`text-xs ${rarityColor(opp.targetRarity)}`}>
                            {opp.targetRarity}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        ${opp.totalCraftCostUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        ${opp.sellPriceUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${profitColor(opp.profitPercent)}`}>
                        ${opp.profitUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${profitColor(opp.profitPercent)}`}>
                        +{opp.profitPercent}%
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {opp.sourceBuyableListings}/{opp.sourceTotalListings}
                      </TableCell>
                      <TableCell>
                        <a
                          href={marketplaceUrl(opp.championName, opp.sourceRarity)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Supply Squeeze Tab */}
      {activeTab === "squeeze" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cards with ≤10 listings — potential buyout and relist opportunities. Estimated profit assumes 1.75× relist after buyout minus 4.25% marketplace fee.
          </p>

          {squeezeQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : squeezeOpps.length === 0 ? (
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-8 text-center text-muted-foreground">
                <Lock className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-lg font-medium">No supply squeeze opportunities found</p>
                <p className="text-sm mt-1">Click "Scan Marketplace" to fetch live data</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[180px]">Champion</TableHead>
                    <TableHead className="text-center">Rarity</TableHead>
                    <TableHead className="text-center">Listings</TableHead>
                    <TableHead className="text-right">Floor</TableHead>
                    <TableHead className="text-right">Buyout Cost</TableHead>
                    <TableHead className="text-right">Est. Relist</TableHead>
                    <TableHead className="text-right">Est. Profit</TableHead>
                    <TableHead className="text-right">Profit %</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {squeezeOpps.slice(0, 50).map((opp) => (
                    <TableRow key={`${opp.championName}-${opp.rarity}`} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{opp.championName}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-xs ${rarityColor(opp.rarity)}`}>
                          {opp.rarity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={opp.buyableListings <= 5 ? "text-red-400 font-bold" : "text-yellow-400"}>
                          {opp.buyableListings}
                        </span>
                        <span className="text-muted-foreground">/{opp.totalListings}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {opp.floorPriceRon.toFixed(2)} RON
                        <div className="text-xs text-muted-foreground">${opp.floorPriceUsd.toFixed(2)}</div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {opp.buyoutCostRon.toFixed(2)} RON
                        <div className="text-xs text-muted-foreground">${opp.buyoutCostUsd.toFixed(2)}</div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {opp.estimatedRelistRon.toFixed(2)} RON
                        <div className="text-xs text-muted-foreground">${opp.estimatedRelistUsd.toFixed(2)}</div>
                      </TableCell>
                      <TableCell className={`text-right text-sm ${profitColor(opp.estimatedProfitPercent)}`}>
                        ${opp.estimatedProfitUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${profitColor(opp.estimatedProfitPercent)}`}>
                        +{opp.estimatedProfitPercent}%
                      </TableCell>
                      <TableCell>
                        <a
                          href={marketplaceUrl(opp.championName, opp.rarity)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
