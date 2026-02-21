/**
 * SchemesScreen - Second screen: gallery of all 35 scheme cards
 * Design: Premium Dark Gaming Dashboard
 * Card artwork prominent, hover effects, filter by trait-based vs all-champion
 */

import { useState, useMemo } from 'react';
import { ArrowLeft, Search, Filter, Wallet, ChevronRight } from 'lucide-react';
import { SchemeCard } from '@/lib/types';

interface SchemesScreenProps {
  schemes: SchemeCard[];
  walletAddress: string;
  onSchemeSelect: (scheme: SchemeCard) => void;
  onBack: () => void;
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Schemes' },
  { value: 'trait', label: 'Trait-Based' },
  { value: 'general', label: 'General' },
];

export default function SchemesScreen({ schemes, walletAddress, onSchemeSelect, onBack }: SchemesScreenProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    let result = schemes;
    if (filter === 'trait') result = result.filter(s => s.hasTraitFilter);
    if (filter === 'general') result = result.filter(s => !s.hasTraitFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    return result;
  }, [schemes, filter, search]);

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  return (
    <div className="min-h-screen arena-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card border-b border-white/5">
        <div className="container py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <div className="w-px h-5 bg-border" />
              <div>
                <h1 className="text-xl font-bold text-gold" style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.05em' }}>
                  SELECT A SCHEME
                </h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Choose a scheme card to see qualifying champions
                </p>
              </div>
            </div>

            {shortAddress && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ background: 'oklch(0.72 0.15 185 / 10%)', border: '1px solid oklch(0.72 0.15 185 / 20%)' }}>
                <Wallet className="w-3.5 h-3.5 text-teal" />
                <span className="font-wallet text-xs text-teal">{shortAddress}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="container py-5">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schemes..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all"
              style={{
                background: 'oklch(1 0 0 / 5%)',
                border: '1px solid oklch(1 0 0 / 10%)',
                color: 'oklch(0.92 0.01 260)',
              }}
              onFocus={(e) => {
                e.target.style.border = '1px solid oklch(0.78 0.16 85 / 40%)';
              }}
              onBlur={(e) => {
                e.target.style.border = '1px solid oklch(1 0 0 / 10%)';
              }}
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: filter === opt.value ? 'oklch(0.78 0.16 85)' : 'oklch(1 0 0 / 5%)',
                  color: filter === opt.value ? 'oklch(0.12 0.02 260)' : 'oklch(0.65 0.02 260)',
                  border: `1px solid ${filter === opt.value ? 'oklch(0.78 0.16 85)' : 'oklch(1 0 0 / 10%)'}`,
                  fontFamily: 'Rajdhani, sans-serif',
                  letterSpacing: '0.03em',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="ml-auto text-sm text-muted-foreground">
            {filtered.length} <span className="text-xs">schemes</span>
          </div>
        </div>
      </div>

      {/* Scheme Cards Grid */}
      <div className="container pb-12">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((scheme, i) => (
            <SchemeCardItem
              key={scheme.name}
              scheme={scheme}
              index={i}
              onClick={() => onSchemeSelect(scheme)}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No schemes found</p>
            <p className="text-sm mt-1">Try a different search term</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SchemeCardItem({
  scheme,
  index,
  onClick,
}: {
  scheme: SchemeCard;
  index: number;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={onClick}
      className="scheme-card group relative rounded-xl overflow-hidden text-left"
      style={{
        background: 'oklch(0.16 0.025 260)',
        border: '1px solid oklch(1 0 0 / 8%)',
        animationDelay: `${Math.min(index * 30, 300)}ms`,
      }}
    >
      {/* Card Image */}
      <div className="relative aspect-[3/4] overflow-hidden">
        {!imgError && scheme.image ? (
          <img
            src={scheme.image}
            alt={scheme.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full skeleton flex items-center justify-center">
            <span className="text-muted-foreground text-xs text-center px-2">{scheme.name}</span>
          </div>
        )}

        {/* Trait badge */}
        {scheme.hasTraitFilter && (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
            style={{
              background: 'oklch(0.72 0.15 185 / 85%)',
              color: 'oklch(0.12 0.02 260)',
              fontFamily: 'Rajdhani, sans-serif',
            }}>
            Trait
          </div>
        )}

        {/* Champion count badge */}
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{
            background: 'oklch(0 0 0 / 70%)',
            color: 'oklch(0.78 0.16 85)',
            fontFamily: 'Rajdhani, sans-serif',
          }}>
          {scheme.qualifyingChampionCount === 180 ? 'ALL' : scheme.qualifyingChampionCount}
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
          style={{ background: 'oklch(0.78 0.16 85 / 15%)' }}>
          <div className="flex items-center gap-1 text-gold text-xs font-bold"
            style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.05em' }}>
            VIEW <ChevronRight className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* Card Info */}
      <div className="p-2.5">
        <h3 className="text-xs font-bold leading-tight text-foreground truncate"
          style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.02em' }}>
          {scheme.name}
        </h3>
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-tight">
          {scheme.description}
        </p>
      </div>
    </button>
  );
}
