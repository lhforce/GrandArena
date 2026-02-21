/**
 * My Cards — Wallet inventory management. Mobile responsive.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Wallet, Search, Shield, Sparkles, Lock,
} from "lucide-react";

const RARITY_COLORS: Record<string, string> = {
  Basic: "text-rarity-basic", Common: "text-rarity-basic",
  Rare: "text-rarity-rare", Epic: "text-rarity-epic", Legendary: "text-rarity-legendary",
};
const RARITY_BORDER: Record<string, string> = {
  Basic: "border-rarity-basic/40", Common: "border-rarity-basic/40",
  Rare: "border-rarity-rare/40", Epic: "border-rarity-epic/40", Legendary: "border-rarity-legendary/40",
};

export default function MyCards() {
  const { isAuthenticated } = useAuth();
  const [walletInput, setWalletInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const utils = trpc.useUtils();

  const settingsQuery = trpc.lineup.settings.useQuery(undefined, { enabled: isAuthenticated });
  const inventoryQuery = trpc.lineup.inventory.useQuery(undefined, { enabled: isAuthenticated });
  const lockupsQuery = trpc.lineup.lockups.useQuery(undefined, { enabled: isAuthenticated });

  const syncMutation = trpc.lineup.syncWallet.useMutation({
    onSuccess: (data) => {
      toast.success(`Synced ${data.totalCards} cards (${data.mokiCount} MOKIs, ${data.schemeCount} SCHEMEs)`);
      utils.lineup.inventory.invalidate();
      utils.lineup.availableCards.invalidate();
    },
    onError: (err) => toast.error(`Sync failed: ${err.message}`),
  });

  const handleSync = () => {
    const addr = walletInput || settingsQuery.data?.walletAddress;
    if (!addr) { toast.error("Enter a wallet address"); return; }
    syncMutation.mutate({ walletAddress: addr });
  };

  const lockedTokenIds = useMemo(() => new Set(lockupsQuery.data?.map((l) => l.tokenId) ?? []), [lockupsQuery.data]);

  const filteredMokis = useMemo(() => {
    let mokis = inventoryQuery.data?.mokis ?? [];
    if (searchQuery) { const q = searchQuery.toLowerCase(); mokis = mokis.filter((m) => m.name?.toLowerCase().includes(q)); }
    if (rarityFilter !== "all") mokis = mokis.filter((m) => m.rarity === rarityFilter);
    return mokis;
  }, [inventoryQuery.data?.mokis, searchQuery, rarityFilter]);

  const filteredSchemes = useMemo(() => {
    let schemes = inventoryQuery.data?.schemes ?? [];
    if (searchQuery) { const q = searchQuery.toLowerCase(); schemes = schemes.filter((s) => s.name?.toLowerCase().includes(q)); }
    return schemes;
  }, [inventoryQuery.data?.schemes, searchQuery]);

  const rarityBreakdown = useMemo(() => {
    const mokis = inventoryQuery.data?.mokis ?? [];
    const counts: Record<string, number> = { Basic: 0, Rare: 0, Epic: 0, Legendary: 0 };
    for (const m of mokis) { const r = m.rarity === "Common" ? "Basic" : (m.rarity ?? "Basic"); counts[r] = (counts[r] ?? 0) + 1; }
    return counts;
  }, [inventoryQuery.data?.mokis]);

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">My Cards</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">View and manage your card inventory</p>
        </div>
        <Card className="glass-card border-gold/20">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4 px-4">
            <Wallet className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm text-center">Please log in to view your cards.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">My Cards</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          {inventoryQuery.data
            ? `${inventoryQuery.data.totalMokis} MOKIs · ${inventoryQuery.data.totalSchemes} SCHEMEs`
            : "Sync your wallet to see your cards"}
        </p>
      </div>

      {/* Wallet Sync */}
      <Card className="glass-card border-teal/20">
        <CardContent className="p-3 sm:pt-4 sm:pb-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-teal shrink-0" />
              <Input
                placeholder="Wallet address (0x...)"
                value={walletInput || settingsQuery.data?.walletAddress || ""}
                onChange={(e) => setWalletInput(e.target.value)}
                className="font-wallet text-xs sm:text-sm flex-1"
              />
            </div>
            <Button onClick={handleSync} disabled={syncMutation.isPending}
              className="bg-teal text-background hover:bg-teal/90 h-10 w-full sm:w-auto">
              {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync Wallet
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rarity Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {(["Basic", "Rare", "Epic", "Legendary"] as const).map((rarity) => (
          <Card key={rarity}
            className={`glass-card cursor-pointer transition-all ${rarityFilter === rarity ? `border-2 ${RARITY_BORDER[rarity]}` : ""}`}
            onClick={() => setRarityFilter(rarityFilter === rarity ? "all" : rarity)}>
            <CardContent className="p-2 sm:pt-3 sm:pb-3 text-center">
              <div className={`text-lg sm:text-2xl font-bold ${RARITY_COLORS[rarity]}`}>
                {rarityBreakdown[rarity] ?? 0}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">{rarity}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search cards..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-10" />
      </div>

      {/* Card Tabs */}
      <Tabs defaultValue="mokis">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="mokis" className="flex-1 sm:flex-initial text-xs sm:text-sm">
            <Shield className="w-3.5 h-3.5 mr-1" /> MOKIs ({filteredMokis.length})
          </TabsTrigger>
          <TabsTrigger value="schemes" className="flex-1 sm:flex-initial text-xs sm:text-sm">
            <Sparkles className="w-3.5 h-3.5 mr-1" /> SCHEMEs ({filteredSchemes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mokis" className="mt-3 sm:mt-4">
          {inventoryQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
          ) : filteredMokis.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No MOKIs found. Sync your wallet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
              {filteredMokis.map((card) => {
                const isLocked = lockedTokenIds.has(card.tokenId);
                return (
                  <div key={card.tokenId}
                    className={`p-2 sm:p-3 rounded-lg border bg-card/50 text-center relative transition-all hover:bg-card/80 ${
                      isLocked ? "opacity-60 border-destructive/30" : RARITY_BORDER[card.rarity ?? "Basic"]
                    }`}>
                    {isLocked && <div className="absolute top-1 right-1"><Lock className="w-3 h-3 text-destructive" /></div>}
                    <Shield className={`w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 ${RARITY_COLORS[card.rarity ?? "Basic"]}`} />
                    <div className="text-[10px] sm:text-xs font-medium truncate" title={card.name ?? ""}>{card.name}</div>
                    <Badge variant="outline" className={`text-[8px] sm:text-[10px] mt-0.5 ${RARITY_COLORS[card.rarity ?? "Basic"]}`}>
                      {card.rarity}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schemes" className="mt-3 sm:mt-4">
          {inventoryQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
          ) : filteredSchemes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No SCHEMEs found. Sync your wallet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 sm:gap-3">
              {filteredSchemes.map((card) => (
                <div key={card.tokenId} className="p-2 sm:p-3 rounded-lg border border-teal/20 bg-teal/5 text-center transition-all hover:bg-teal/10">
                  <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 text-teal" />
                  <div className="text-[10px] sm:text-xs font-medium truncate" title={card.name ?? ""}>{card.name}</div>
                  <Badge variant="outline" className="text-[8px] sm:text-[10px] mt-0.5 text-teal">Scheme</Badge>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
