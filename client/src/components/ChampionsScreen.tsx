/**
 * ChampionsScreen - Third screen: champions qualifying for selected scheme
 * Design: Premium Dark Gaming Dashboard
 * Shows card artwork, ownership status, marketplace prices
 * Uses tRPC backend proxy to bypass Ronin Marketplace CORS restrictions
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
type RarityFilter = 'all' | 'Basic' | 'Rare' | 'Epic' | 'Legendary';

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

  const champions = scheme.qualifyingChampions;

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

  // Get unique champion names for unowned champions
  const unownedNames = useMemo(() => {
    const names = champions
      .filter(c => !ownedIds.has(c.championTokenId))
      .map(c => c.name);
    return Array.from(new Set(names));
  }, [champions, ownedIds]);

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

    // Process in batches of 6 names at a time
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
    if (rarityFilter !== 'all') result = result.filter(c => c.rarity === rarityFilter);
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
        const pa = floorPrices.get(a.name)?.[a.rarity] ?? Infinity;
        const pb = floorPrices.get(b.name)?.[b.rarity] ?? Infinity;
        return pa - pb;
      });
    }

    return result;
  }, [champions, filterMode, rarityFilter, search, sortBy, ownedIds, floorPrices]);

  const ownedCount = champions.filter(c => ownedIds.has(c.championTokenId)).length;
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : null;

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
              {champions.length} Champions
            </span>
          </div>
          {walletAddress && !loadingOwned && (
            <>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-3.5 h-3.5" style={{ color: 'oklch(0.65 0.18 145)' }} />
                <span className="text-muted-foreground">Owned:</span>
                <span className="font-bold" style={{ color: 'oklch(0.65 0.18 145)', fontFamily: 'Rajdhani, sans-serif' }}>
                  {ownedCount}/{champions.length}
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
          <div className="flex gap-1">
            {(['all', 'Basic', 'Rare', 'Epic', 'Legendary'] as RarityFilter[]).map(r => {
              const colors = r !== 'all' ? RARITY_COLORS[r] : null;
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {displayChampions.map((champion, i) => {
              const isOwned = ownedIds.has(champion.championTokenId);
              const prices = floorPrices.get(champion.name);
              return (
                <ChampionCard
                  key={`${champion.championTokenId}-${champion.rarity}`}
                  champion={champion}
                  isOwned={isOwned}
                  prices={prices}
                  hasWallet={!!walletAddress}
                  pricesEnabled={pricesEnabled}
                  index={i}
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
}: {
  champion: Champion;
  isOwned: boolean;
  prices?: Record<string, number | null>;
  hasWallet: boolean;
  pricesEnabled: boolean;
  index: number;
}) {
  const [imgError, setImgError] = useState(false);
  const colors = RARITY_COLORS[champion.rarity] ?? RARITY_COLORS.Basic;
  const floorPrice = prices?.[champion.rarity];

  const marketplaceUrl = `https://marketplace.roninchain.com/collections/0x9e8ed4ff354bd11602255b3d8e1ed13a1bb26b4b?criteria=%5B%7B%22name%22%3A%22Card+Type%22%2C%22values%22%3A%5B%22MOKI%22%5D%7D%2C%7B%22name%22%3A%22Rarity%22%2C%22values%22%3A%5B%22${champion.rarity}%22%5D%7D%5D&name=${encodeURIComponent(champion.name)}&sort=PRICE_ASC`;

  return (
    <div
      className="champion-card group relative rounded-xl overflow-hidden"
      style={{
        background: 'oklch(0.16 0.025 260)',
        border: `1px solid ${isOwned ? 'oklch(0.55 0.18 145 / 50%)' : colors.border + ' / 30%'}`,
        animationDelay: `${Math.min(index * 25, 400)}ms`,
        boxShadow: isOwned ? '0 0 12px oklch(0.55 0.18 145 / 20%)' : 'none',
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

        {/* 1 of 1 badge */}
        {champion.is1of1 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              background: 'oklch(0.75 0.18 60 / 90%)',
              color: 'oklch(0.12 0.02 260)',
              fontFamily: 'Rajdhani, sans-serif',
            }}>
            1/1
          </div>
        )}

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

        {/* Rarity badge + floor price for this rarity */}
        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: colors.bg,
              color: colors.text,
              fontFamily: 'Rajdhani, sans-serif',
              letterSpacing: '0.05em',
            }}>
            {champion.rarity.toUpperCase()}
          </span>

          {/* Floor price for this rarity */}
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
