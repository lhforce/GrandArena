/**
 * My Cards — Wallet inventory management.
 * Shows all owned MOKIs and SCHEMEs, with sync from Ronin Marketplace.
 * Displays rarity breakdown, locked cards, and duplicate tracking.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  Wallet,
  Search,
  Shield,
  Sparkles,
  Lock,
  Copy,
  Filter,
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

const RARITY_BORDER: Record<string, string> = {
  Basic: "border-rarity-basic/40",
  Common: "border-rarity-basic/40",
  Rare: "border-rarity-rare/40",
  Epic: "border-rarity-epic/40",
  Legendary: "border-rarity-legendary/40",
};

export default function MyCards() {
  const { isAuthenticated } = useAuth();
  const [walletInput, setWalletInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const utils = trpc.useUtils();

  // Get user settings for wallet address
  const settingsQuery = trpc.lineup.settings.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Get inventory
  const inventoryQuery = trpc.lineup.inventory.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Get lockups
  const lockupsQuery = trpc.lineup.lockups.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Sync mutation
  const syncMutation = trpc.lineup.syncWallet.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Synced ${data.totalCards} cards (${data.mokiCount} MOKIs, ${data.schemeCount} SCHEMEs, ${data.duplicateMokis} duplicates)`
      );
      utils.lineup.inventory.invalidate();
      utils.lineup.availableCards.invalidate();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const handleSync = () => {
    const addr = walletInput || settingsQuery.data?.walletAddress;
    if (!addr) {
      toast.error("Please enter a wallet address");
      return;
    }
    syncMutation.mutate({ walletAddress: addr });
  };

  // Locked token IDs set
  const lockedTokenIds = useMemo(() => {
    return new Set(lockupsQuery.data?.map((l) => l.tokenId) ?? []);
  }, [lockupsQuery.data]);

  // Filtered MOKIs
  const filteredMokis = useMemo(() => {
    let mokis = inventoryQuery.data?.mokis ?? [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      mokis = mokis.filter((m) => m.name?.toLowerCase().includes(q));
    }
    if (rarityFilter !== "all") {
      mokis = mokis.filter((m) => m.rarity === rarityFilter);
    }
    return mokis;
  }, [inventoryQuery.data?.mokis, searchQuery, rarityFilter]);

  // Filtered SCHEMEs
  const filteredSchemes = useMemo(() => {
    let schemes = inventoryQuery.data?.schemes ?? [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      schemes = schemes.filter((s) => s.name?.toLowerCase().includes(q));
    }
    return schemes;
  }, [inventoryQuery.data?.schemes, searchQuery]);

  // Rarity breakdown
  const rarityBreakdown = useMemo(() => {
    const mokis = inventoryQuery.data?.mokis ?? [];
    const counts: Record<string, number> = { Basic: 0, Rare: 0, Epic: 0, Legendary: 0 };
    for (const m of mokis) {
      const r = m.rarity === "Common" ? "Basic" : (m.rarity ?? "Basic");
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [inventoryQuery.data?.mokis]);

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gold">My Cards</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and manage your card inventory
          </p>
        </div>
        <Card className="glass-card border-gold/20">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Wallet className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground">Please log in to view your cards.</p>
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
          <h1 className="text-2xl font-bold tracking-tight text-gold">My Cards</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {inventoryQuery.data
              ? `${inventoryQuery.data.totalMokis} MOKIs · ${inventoryQuery.data.totalSchemes} SCHEMEs`
              : "Sync your wallet to see your cards"}
          </p>
        </div>
      </div>

      {/* Wallet Sync */}
      <Card className="glass-card border-teal/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-teal shrink-0" />
            <Input
              placeholder="Enter wallet address (0x...)"
              value={walletInput || settingsQuery.data?.walletAddress || ""}
              onChange={(e) => setWalletInput(e.target.value)}
              className="font-wallet text-sm flex-1"
            />
            <Button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="bg-teal text-background hover:bg-teal/90"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sync Wallet
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rarity Breakdown */}
      <div className="grid grid-cols-4 gap-3">
        {(["Basic", "Rare", "Epic", "Legendary"] as const).map((rarity) => (
          <Card
            key={rarity}
            className={`glass-card cursor-pointer transition-all ${
              rarityFilter === rarity ? `border-2 ${RARITY_BORDER[rarity]}` : ""
            }`}
            onClick={() => setRarityFilter(rarityFilter === rarity ? "all" : rarity)}
          >
            <CardContent className="pt-3 pb-3 text-center">
              <div className={`text-2xl font-bold ${RARITY_COLORS[rarity]}`}>
                {rarityBreakdown[rarity] ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">{rarity}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search cards by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Card Tabs */}
      <Tabs defaultValue="mokis">
        <TabsList>
          <TabsTrigger value="mokis">
            <Shield className="w-4 h-4 mr-1" />
            MOKIs ({filteredMokis.length})
          </TabsTrigger>
          <TabsTrigger value="schemes">
            <Sparkles className="w-4 h-4 mr-1" />
            SCHEMEs ({filteredSchemes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mokis" className="mt-4">
          {inventoryQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : filteredMokis.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No MOKIs found. Sync your wallet to load cards.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredMokis.map((card) => {
                const isLocked = lockedTokenIds.has(card.tokenId);
                return (
                  <div
                    key={card.tokenId}
                    className={`p-3 rounded-lg border bg-card/50 text-center relative transition-all hover:bg-card/80 ${
                      isLocked ? "opacity-60 border-destructive/30" : RARITY_BORDER[card.rarity ?? "Basic"]
                    }`}
                  >
                    {isLocked && (
                      <div className="absolute top-1 right-1">
                        <Lock className="w-3 h-3 text-destructive" />
                      </div>
                    )}
                    <Shield
                      className={`w-8 h-8 mx-auto mb-2 ${RARITY_COLORS[card.rarity ?? "Basic"]}`}
                    />
                    <div className="text-xs font-medium truncate" title={card.name ?? ""}>
                      {card.name}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] mt-1 ${RARITY_COLORS[card.rarity ?? "Basic"]}`}
                    >
                      {card.rarity}
                    </Badge>
                    <div className="text-[10px] text-muted-foreground mt-1 font-wallet truncate">
                      #{card.tokenId}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schemes" className="mt-4">
          {inventoryQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : filteredSchemes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No SCHEMEs found. Sync your wallet to load cards.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredSchemes.map((card) => (
                <div
                  key={card.tokenId}
                  className="p-3 rounded-lg border border-teal/20 bg-teal/5 text-center transition-all hover:bg-teal/10"
                >
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-teal" />
                  <div className="text-xs font-medium truncate" title={card.name ?? ""}>
                    {card.name}
                  </div>
                  <Badge variant="outline" className="text-[10px] mt-1 text-teal">
                    Scheme
                  </Badge>
                  <div className="text-[10px] text-muted-foreground mt-1 font-wallet truncate">
                    #{card.tokenId}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
