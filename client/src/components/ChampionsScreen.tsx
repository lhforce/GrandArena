/**
 * ChampionsScreen - Third screen: champions qualifying for selected scheme
 * Design: Premium Dark Gaming Dashboard
 * Shows card artwork, ownership status, marketplace prices
 * Uses tRPC backend proxy to bypass Ronin Marketplace CORS restrictions
 *
 * Special Whale Watching mode:
 * - All 27 champions shown under every rarity tab (Basic/Rare/Epic/Legendary/FA)
 * - Each tab shows the rarity-specific card artwork
 * - FA tab only visible for Whale Watching scheme
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Wallet, Search, CheckCircle, ShoppingCart, Loader2, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react';
import { SchemeCard, Champion, RARITY_ORDER } from '@/lib/types';
import { trpc } from '@/lib/trpc';

interface ChampionsScreenProps {
  scheme: SchemeCard;
  walletAddress: string;
  onBack: () => void;
}

type FilterMode = 'all' | 'owned' | 'not-owned';
type RarityFilter = 'all' | 'Basic' | 'Rare' | 'Epic' | 'Legendary' | 'FA';

const RARITY_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  Basic: {
    border: 'oklch(0.55 0.03 250)',
    text: 'oklch(0.7 0.04 250)',
    bg: 'oklch(0.55 0.03 250 / 15%)',
  },
  Rare: {
    border: 'oklch(0.55 0.18 240)',
    text: 'oklch(0.65 0.2 240)',
    bg: 'oklch(0.55 0.18 240 / 15%)',
  },
  Epic: {
    border: 'oklch(0.55 0.22 295)',
    text: 'oklch(0.7 0.22 295)',
    bg: 'oklch(0.55 0.22 295 / 15%)',
  },
  Legendary: {
    // Pink/holographic for 1-of-1 Legendary
    border: 'oklch(0.72 0.22 340)',
    text: 'oklch(0.85 0.2 340)',
    bg: 'oklch(0.72 0.22 340 / 15%)',
  },
  FA: {
    // Gold/bronze for Full Art
    border: 'oklch(0.75 0.18 60)',
    text: 'oklch(0.82 0.18 60)',
    bg: 'oklch(0.75 0.18 60 / 15%)',
  },
};

export default function ChampionsScreen({ scheme, walletAddress, onBack }: ChampionsScreenProps) {
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [floorPrices, setFloorPrices] = useState<Map<string, Record<string, number | null>>>(new Map());
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceLoadProgress, setPriceLoadProgress] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'rarity' | 'price'>('rarity');
  const [pricesEnabled, setPricesEnabled] = useState(false);
  const priceLoadRef = useRef(false);

  const isWhaleWatching = scheme.hasMultiRarity === true;
  const baseChampions = scheme.qualifyingChampions;

  // Fetch owned champions via tRPC proxy
  const { data: walletData, isLoading: loadingOwned } = trpc.getWalletChampions.useQuery(
    { walletAddress },
    { enabled: !!walletAddress, retry: 1, staleTime: 60_000 }
  );

  useEffect(() => {
    if (walletData?.ownedChampionIds) {
      setOwnedIds(new Set(walletData.ownedChampionIds));
    }
  }, [walletData]);

  /**
   * For Whale Watching: build virtual champion entries per rarity tab.
   * Each champion appears once per rarity with the correct rarity-specific image.
   * For non-Whale Watching schemes: use champions as-is.
   */
  const champions = useMemo(() => {
    if (!isWhaleWatching || rarityFilter === 'all') {
      // For "All" tab in Whale Watching, show each champion once (their base rarity image)
      return baseChampions;
    }
    // For a specific rarity tab in Whale Watching, show all 27 with that rarity's artwork
    return baseChampions.map(c => {
      const rarityImage = c.rarityImages?.[rarityFilter] ?? c.image;
      return {
        ...c,
        // Override the displayed image and rarity for this tab
        image: rarityImage || c.image,
        rarity: rarityFilter === 'FA' ? 'FA' : rarityFilter,
        // Keep original championTokenId for ownership check
      };
    });
  }, [baseChampions, isWhaleWatching, rarityFilter]);

  // Get unique champion names for unowned champions
  const unownedNames = useMemo(() => {
    const names = baseChampions
      .filter(c => !ownedIds.has(c.championTokenId))
      .map(c => c.name);
    return Array.from(new Set(names));
  }, [baseChampions, ownedIds]);

  // tRPC utils for manual queries
  const utils = trpc.useUtils();

  // Fetch prices in batches via tRPC
  const loadFloorPrices = useCallback(async () => {
    if (priceLoadRef.current || unownedNames.length === 0) return;
    priceLoadRef.current = true;
    setLoadingPrices(true);
    setPriceLoadProgress(0);
    setPricesEnabled(true);
    setFloorPrices(new Map());

    const BATCH_SIZE = 6;
    const batches: string[][] = [];
    for (let i = 0; i < unownedNames.length; i += BATCH_SIZE) {
      batches.push(unownedNames.slice(i, i + BATCH_SIZE));
    }

    let done = 0;
    for (const batch of batches) {
      try {
        const result = await utils.getBatchFloorPrices.fetch({ championNames: batch });
        if (result?.prices) {
          setFloorPrices(prev => {
            const next = new Map(prev);
            for (const [name, prices] of Object.entries(result.prices)) {
              next.set(name, prices);
            }
            return next;
          });
        }
      } catch (e) {
        console.error('Price fetch error:', e);
      }
      done += batch.length;
      setPriceLoadProgress(Math.round((done / unownedNames.length) * 100));
    }

    setLoadingPrices(false);
    priceLoadRef.current = false;
  }, [unownedNames, utils]);

  const refreshPrices = useCallback(() => {
    priceLoadRef.current = false;
    setPricesEnabled(false);
    setFloorPrices(new Map());
    setTimeout(() => loadFloorPrices(), 100);
  }, [loadFloorPrices]);

  // Filtered and sorted champions
  const displayChampions = useMemo(() => {
    let result = [...champions];

    if (filterMode === 'owned') result = result.filter(c => ownedIds.has(c.championTokenId));
    if (filterMode === 'not-owned') result = result.filter(c => !ownedIds.has(c.championTokenId));

    // For non-Whale Watching, apply rarity filter normally
    if (!isWhaleWatching && rarityFilter !== 'all') {
      result = result.filter(c => c.rarity === rarityFilter);
    }
    // For Whale Watching, rarity filtering is already handled by the `champions` memo above

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q));
    }

    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'rarity') {
      result.sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity);
        const rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
    } else if (sortBy === 'price') {
      result.sort((a, b) => {
        const activeRarity = rarityFilter !== 'all' ? rarityFilter : a.rarity;
        const pa = floorPrices.get(a.name)?.[activeRarity] ?? Infinity;
        const pb = floorPrices.get(b.name)?.[activeRarity] ?? Infinity;
        return pa - pb;
      });
    }

    return result;
  }, [champions, filterMode, rarityFilter, search, sortBy, ownedIds, floorPrices, isWhaleWatching]);

  const ownedCount = baseChampions.filter(c => ownedIds.has(c.championTokenId)).length;
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : null;

  // Rarity tabs: add FA only for Whale Watching
  const rarityTabs: RarityFilter[] = isWhaleWatching
    ? ['all', 'Basic', 'Rare', 'Epic', 'Legendary', 'FA']
    : ['all', 'Basic', 'Rare', 'Epic', 'Legendary'];

  return (
    <div className="min-h-screen arena-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card border-b border-white/5">
        <div className="container py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Schemes</span>
            </button>
            <div className="w-px h-5 bg-border" />

            {/* Scheme info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {scheme.image && (
                <img
                  src={scheme.image}
                  alt={scheme.name}
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                  style={{ border: '1px solid oklch(0.78 0.16 85 / 30%)' }}
                />
              )}
              <div className="min-w-0">
                <h1 className="text-base font-bold text-gold truncate"
                  style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.05em' }}>
                  {scheme.name.toUpperCase()}
                </h1>
                <p className="text-xs text-muted-foreground truncate hidden sm:block">
                  {scheme.description}
                </p>
              </div>
            </div>

            {shortAddress && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0 hidden sm:flex"
                style={{ background: 'oklch(0.72 0.15 185 / 10%)', border: '1px solid oklch(0.72 0.15 185 / 20%)' }}>
                <Wallet className="w-3.5 h-3.5 text-teal" />
                <span className="font-wallet text-xs text-teal">{shortAddress}</span>
                {loadingOwned && <Loader2 className="w-3 h-3 animate-spin text-teal" />}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="container py-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Qualifying:</span>
            <span className="font-bold text-gold" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
              {baseChampions.length} Champions
            </span>
          </div>
          {walletAddress && !loadingOwned && (
            <>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-3.5 h-3.5" style={{ color: 'oklch(0.65 0.18 145)' }} />
                <span className="text-muted-foreground">Owned:</span>
                <span className="font-bold" style={{ color: 'oklch(0.65 0.18 145)', fontFamily: 'Rajdhani, sans-serif' }}>
                  {ownedCount}/{baseChampions.length}
                </span>
              </div>
            </>
          )}
          {loadingOwned && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking ownership...
            </div>
          )}

          {/* Load prices button */}
          {!loadingPrices && !pricesEnabled && (
            <button
              onClick={loadFloorPrices}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
              style={{
                background: 'oklch(0.55 0.18 60 / 15%)',
                border: '1px solid oklch(0.55 0.18 60 / 30%)',
                color: 'oklch(0.82 0.18 60)',
                fontFamily: 'Rajdhani, sans-serif',
                letterSpacing: '0.03em',
              }}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              LOAD PRICES
            </button>
          )}
          {loadingPrices && (
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading prices... {priceLoadProgress}%
            </div>
          )}
          {!loadingPrices && pricesEnabled && (
            <button
              onClick={refreshPrices}
              className="ml-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh Prices
            </button>
          )}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search champions..."
              className="pl-8 pr-3 py-2 rounded-lg text-xs outline-none transition-all"
              style={{
                background: 'oklch(1 0 0 / 5%)',
                border: '1px solid oklch(1 0 0 / 10%)',
                color: 'oklch(0.92 0.01 260)',
                width: '180px',
              }}
              onFocus={(e) => { e.target.style.border = '1px solid oklch(0.78 0.16 85 / 40%)'; }}
              onBlur={(e) => { e.target.style.border = '1px solid oklch(1 0 0 / 10%)'; }}
            />
          </div>

          {/* Ownership filter */}
          {walletAddress && (
            <div className="flex gap-1">
              {(['all', 'owned', 'not-owned'] as FilterMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: filterMode === mode
                      ? mode === 'owned' ? 'oklch(0.55 0.18 145 / 80%)' : mode === 'not-owned' ? 'oklch(0.55 0.18 60 / 80%)' : 'oklch(0.78 0.16 85)'
                      : 'oklch(1 0 0 / 5%)',
                    color: filterMode === mode ? 'oklch(0.12 0.02 260)' : 'oklch(0.65 0.02 260)',
                    border: `1px solid ${filterMode === mode ? 'transparent' : 'oklch(1 0 0 / 10%)'}`,
                    fontFamily: 'Rajdhani, sans-serif',
                    letterSpacing: '0.02em',
                  }}
                >
                  {mode === 'all' ? 'All' : mode === 'owned' ? '✓ Owned' : '$ Not Owned'}
                </button>
              ))}
            </div>
          )}

          {/* Rarity filter */}
          <div className="flex gap-1 flex-wrap">
            {rarityTabs.map(r => {
              const colors = r !== 'all' ? RARITY_COLORS[r] : null;
              const isFA = r === 'FA';
              return (
                <button
                  key={r}
                  onClick={() => setRarityFilter(r)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: rarityFilter === r
                      ? colors ? colors.bg : 'oklch(0.78 0.16 85 / 20%)'
                      : 'oklch(1 0 0 / 5%)',
                    color: rarityFilter === r
                      ? colors ? colors.text : 'oklch(0.78 0.16 85)'
                      : 'oklch(0.65 0.02 260)',
                    border: `1px solid ${rarityFilter === r
                      ? colors ? colors.border : 'oklch(0.78 0.16 85 / 40%)'
                      : 'oklch(1 0 0 / 10%)'}`,
                    fontFamily: 'Rajdhani, sans-serif',
                    letterSpacing: '0.02em',
                    // FA tab gets a special shimmer treatment
                    ...(isFA && rarityFilter !== 'FA' ? {
                      background: 'linear-gradient(135deg, oklch(0.75 0.18 60 / 8%), oklch(0.72 0.22 340 / 8%))',
                      border: '1px solid oklch(0.75 0.18 60 / 25%)',
                      color: 'oklch(0.75 0.15 60)',
                    } : {}),
                  }}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              );
            })}
          </div>

          {/* Sort */}
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronDown className="w-3 h-3" />
            <span>Sort:</span>
            {(['rarity', 'name', 'price'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className="px-2 py-1 rounded text-xs transition-all capitalize"
                style={{
                  color: sortBy === s ? 'oklch(0.78 0.16 85)' : 'oklch(0.55 0.02 260)',
                  fontWeight: sortBy === s ? '600' : '400',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="text-xs text-muted-foreground">
            {displayChampions.length} shown
          </div>
        </div>

        {/* Whale Watching rarity info banner */}
        {isWhaleWatching && rarityFilter !== 'all' && (
          <div className="mt-3 px-3 py-2 rounded-lg text-xs"
            style={{
              background: rarityFilter === 'FA'
                ? 'linear-gradient(135deg, oklch(0.75 0.18 60 / 10%), oklch(0.72 0.22 340 / 10%))'
                : `${RARITY_COLORS[rarityFilter]?.bg ?? 'oklch(0.55 0.03 250 / 15%)'}`,
              border: `1px solid ${rarityFilter === 'FA'
                ? 'oklch(0.75 0.18 60 / 30%)'
                : `${RARITY_COLORS[rarityFilter]?.border ?? 'oklch(0.55 0.03 250)'} / 30%`}`,
              color: rarityFilter === 'FA'
                ? 'oklch(0.82 0.18 60)'
                : RARITY_COLORS[rarityFilter]?.text ?? 'oklch(0.7 0.04 250)',
            }}>
            {rarityFilter === 'FA'
              ? `Showing Full Art (FA) versions of all ${baseChampions.length} 1-of-1 Mokis — these are the rarest cards in the game.`
              : `Showing ${rarityFilter} versions of all ${baseChampions.length} 1-of-1 Mokis — every 1-of-1 Moki exists in all rarities.`
            }
          </div>
        )}
      </div>

      {/* Champions Grid */}
      <div className="container pb-12">
        {displayChampions.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No champions found</p>
            <p className="text-sm mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 sm:gap-3">
            {displayChampions.map((champion, i) => {
              const isOwned = ownedIds.has(champion.championTokenId);
              const prices = floorPrices.get(champion.name);
              return (
                <ChampionCard
                  key={`${champion.championTokenId}-${rarityFilter}-${i}`}
                  champion={champion}
                  isOwned={isOwned}
                  prices={prices}
                  hasWallet={!!walletAddress}
                  pricesEnabled={pricesEnabled}
                  index={i}
                  activeRarityFilter={rarityFilter}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ChampionCard({
  champion,
  isOwned,
  prices,
  hasWallet,
  pricesEnabled,
  index,
  activeRarityFilter,
}: {
  champion: Champion;
  isOwned: boolean;
  prices?: Record<string, number | null>;
  hasWallet: boolean;
  pricesEnabled: boolean;
  index: number;
  activeRarityFilter: RarityFilter;
}) {
  const [imgError, setImgError] = useState(false);

  // Determine display rarity for styling
  // For Whale Watching (1-of-1 cards), use the active rarity tab so the card image and marketplace URL match the selected tab
  const displayRarity: RarityFilter = (champion.is1of1 && activeRarityFilter !== 'all')
    ? activeRarityFilter
    : (champion.rarity === 'FA' ? 'FA' : (champion.rarity as RarityFilter));
  const colors = RARITY_COLORS[displayRarity as string] ?? RARITY_COLORS.Basic;

  // For price display, use the active rarity filter (or champion's own rarity for "all" tab)
  const priceRarity = activeRarityFilter !== 'all' && activeRarityFilter !== 'FA'
    ? activeRarityFilter
    : (champion.rarity === 'FA' ? 'Legendary' : champion.rarity);
  const floorPrice = prices?.[priceRarity];

  // Marketplace URL - use Champion Token ID format (correct Ronin Marketplace URL format)
  // For 1-of-1 / Whale Watching cards: filter by Champion Token ID range + Rarity
  // For FA: also add Category=Full%20Art filter
  const BASE_MARKET = 'https://marketplace.roninchain.com/collections/0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b';
  const champTokenId = champion.championTokenId;
  const marketplaceUrl = champTokenId
    ? displayRarity === 'FA'
      ? `${BASE_MARKET}?Category=Full%20Art&Champion%20Token%20ID_max=${champTokenId}&Champion%20Token%20ID_min=${champTokenId}&Rarity=Legendary`
      : `${BASE_MARKET}?Champion%20Token%20ID_max=${champTokenId}&Champion%20Token%20ID_min=${champTokenId}&Rarity=${encodeURIComponent(displayRarity)}`
    : `${BASE_MARKET}?search=${encodeURIComponent(champion.name)}`;

  // Special border glow for Legendary (pink) and FA (gold)
  const isLegendary = displayRarity === 'Legendary';
  const isFA = displayRarity === 'FA';

  return (
    <div
      className="champion-card group relative rounded-xl overflow-hidden"
      style={{
        background: isLegendary
          ? 'linear-gradient(160deg, oklch(0.18 0.04 340), oklch(0.15 0.02 260))'
          : isFA
            ? 'linear-gradient(160deg, oklch(0.18 0.04 60), oklch(0.15 0.02 260))'
            : 'oklch(0.16 0.025 260)',
        border: `1px solid ${isOwned ? 'oklch(0.55 0.18 145 / 50%)' : colors.border + ' / 30%'}`,
        animationDelay: `${Math.min(index * 25, 400)}ms`,
        boxShadow: isOwned
          ? '0 0 12px oklch(0.55 0.18 145 / 20%)'
          : isLegendary
            ? '0 0 16px oklch(0.72 0.22 340 / 15%)'
            : isFA
              ? '0 0 16px oklch(0.75 0.18 60 / 15%)'
              : 'none',
      }}
    >
      {/* Card Image */}
      <div className="relative aspect-[3/4] overflow-hidden">
        {!imgError && champion.image ? (
          <img
            src={champion.image}
            alt={champion.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full skeleton flex items-center justify-center">
            <span className="text-muted-foreground text-xs text-center px-2">{champion.name}</span>
          </div>
        )}

        {/* Owned badge */}
        {hasWallet && isOwned && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              background: 'oklch(0.45 0.18 145 / 90%)',
              color: 'oklch(0.95 0.05 145)',
              fontFamily: 'Rajdhani, sans-serif',
            }}>
            <CheckCircle className="w-2.5 h-2.5" />
            OWNED
          </div>
        )}

        {/* Rarity badge top-right */}
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{
            background: isFA
              ? 'linear-gradient(135deg, oklch(0.75 0.18 60 / 90%), oklch(0.72 0.22 340 / 90%))'
              : `${colors.bg.replace('15%', '90%')}`,
            color: isFA ? 'oklch(0.12 0.02 260)' : colors.text,
            fontFamily: 'Rajdhani, sans-serif',
            border: `1px solid ${colors.border}`,
          }}>
          {isFA ? 'FA' : '1/1'}
        </div>

        {/* Marketplace link overlay */}
        <a
          href={marketplaceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
          style={{ background: 'oklch(0 0 0 / 40%)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 text-white text-xs font-bold bg-black/50 px-2 py-1 rounded-lg"
            style={{ fontFamily: 'Rajdhani, sans-serif' }}>
            <ExternalLink className="w-3 h-3" />
            MARKET
          </div>
        </a>
      </div>

      {/* Card Info */}
      <div className="p-2">
        <h3 className="text-xs font-bold leading-tight truncate"
          style={{ fontFamily: 'Rajdhani, sans-serif', color: 'oklch(0.92 0.01 260)', letterSpacing: '0.02em' }}>
          {champion.name}
        </h3>

        {/* Rarity badge + floor price */}
        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: isFA
                ? 'linear-gradient(135deg, oklch(0.75 0.18 60 / 20%), oklch(0.72 0.22 340 / 20%))'
                : colors.bg,
              color: colors.text,
              fontFamily: 'Rajdhani, sans-serif',
              letterSpacing: '0.05em',
            }}>
            {isFA ? 'FULL ART' : displayRarity.toUpperCase()}
          </span>

          {/* Floor price for active rarity */}
          {!isOwned && pricesEnabled && prices !== undefined && (
            <span className="text-[9px] font-bold"
              style={{ color: floorPrice ? 'oklch(0.82 0.18 60)' : 'oklch(0.45 0.02 260)', fontFamily: 'Rajdhani, sans-serif' }}>
              {floorPrice != null ? `${floorPrice} RON` : 'N/A'}
            </span>
          )}
        </div>

        {/* All rarity prices for unowned when prices loaded */}
        {!isOwned && pricesEnabled && prices !== undefined && (
          <div className="mt-1.5 space-y-0.5">
            {(['Basic', 'Rare', 'Epic', 'Legendary'] as const)
              .filter(r => prices[r] != null)
              .map(rarity => {
                const rc = RARITY_COLORS[rarity] ?? RARITY_COLORS.Basic;
                return (
                  <div key={rarity} className="flex items-center justify-between">
                    <span className="text-[8px] font-medium" style={{ color: rc.text, fontFamily: 'Rajdhani, sans-serif' }}>
                      {rarity[0]}
                    </span>
                    <span className="text-[8px]" style={{ color: 'oklch(0.75 0.12 60)' }}>
                      {prices[rarity]} RON
                    </span>
                  </div>
                );
              })}
            {Object.values(prices).every(p => p === null) && (
              <p className="text-[8px] text-muted-foreground">No listings</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
