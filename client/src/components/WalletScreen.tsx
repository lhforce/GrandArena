/**
 * WalletScreen - First screen of the Grand Arena Scheme Card Tool
 * Design: Premium Dark Gaming Dashboard
 * Deep navy background, gold accents, glassmorphism input panel
 */

import { useState } from 'react';
import { Wallet, ArrowRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WalletScreenProps {
  onWalletSubmit: (address: string) => void;
}

export default function WalletScreen({ onWalletSubmit }: WalletScreenProps) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  const isValidAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) {
      setError('Please enter a wallet address');
      return;
    }
    if (!isValidAddress(trimmed)) {
      setError('Invalid Ronin wallet address (must start with 0x and be 42 characters)');
      return;
    }
    setError('');
    onWalletSubmit(trimmed);
  };

  const handleSkip = () => {
    onWalletSubmit('');
  };

  return (
    <div className="min-h-screen arena-bg flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, oklch(0.78 0.16 85), transparent)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, oklch(0.72 0.15 185), transparent)' }} />
        <div className="absolute top-0 left-0 right-0 h-px opacity-20"
          style={{ background: 'linear-gradient(90deg, transparent, oklch(0.78 0.16 85), transparent)' }} />
      </div>

      {/* Logo / Header */}
      <div className="mb-10 text-center relative z-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'oklch(0.78 0.16 85 / 15%)', border: '1px solid oklch(0.78 0.16 85 / 30%)' }}>
            <Zap className="w-6 h-6 text-gold" />
          </div>
          <div className="text-left">
            <div className="text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground">Moku</div>
            <h1 className="text-2xl font-bold text-gold" style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.05em' }}>
              GRAND ARENA
            </h1>
          </div>
        </div>
        <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-3" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
          Scheme Card Tool
        </h2>
        <p className="text-muted-foreground text-base max-w-md mx-auto leading-relaxed">
          Find the best Champions for any Scheme card. Check ownership and marketplace prices in one place.
        </p>
      </div>

      {/* Wallet Input Card */}
      <div className="w-full max-w-md relative z-10">
        <div className="glass-card rounded-2xl p-6 md:p-8">
          <div className="flex items-center gap-2 mb-6">
            <Wallet className="w-5 h-5 text-teal" />
            <h3 className="text-lg font-semibold" style={{ fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.03em' }}>
              Connect Your Wallet
            </h3>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Ronin Wallet Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setError(''); }}
                placeholder="0x55c26Db6b037eF38..."
                className="w-full px-4 py-3 rounded-xl font-wallet text-sm transition-all outline-none"
                style={{
                  background: 'oklch(1 0 0 / 6%)',
                  border: `1px solid ${error ? 'oklch(0.65 0.22 25)' : 'oklch(1 0 0 / 12%)'}`,
                  color: 'oklch(0.92 0.01 260)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
                onFocus={(e) => {
                  e.target.style.border = '1px solid oklch(0.78 0.16 85 / 60%)';
                  e.target.style.boxShadow = '0 0 0 3px oklch(0.78 0.16 85 / 10%)';
                }}
                onBlur={(e) => {
                  e.target.style.border = error ? '1px solid oklch(0.65 0.22 25)' : '1px solid oklch(1 0 0 / 12%)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              {error && (
                <p className="mt-2 text-sm" style={{ color: 'oklch(0.65 0.22 25)' }}>{error}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold rounded-xl transition-all"
              style={{
                background: 'oklch(0.78 0.16 85)',
                color: 'oklch(0.12 0.02 260)',
                fontFamily: 'Rajdhani, sans-serif',
                letterSpacing: '0.05em',
              }}
            >
              <span>ENTER ARENA</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid oklch(1 0 0 / 8%)' }}>
            <button
              onClick={handleSkip}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              Browse without wallet (no ownership filter)
            </button>
          </div>
        </div>

        {/* Feature hints */}
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { label: '35 Schemes', sub: 'All Season 1' },
            { label: '180 Champions', sub: 'Full roster' },
            { label: 'Live Prices', sub: 'Marketplace' },
          ].map((f) => (
            <div key={f.label} className="glass-card rounded-xl p-3">
              <div className="text-gold font-bold text-sm" style={{ fontFamily: 'Rajdhani, sans-serif' }}>{f.label}</div>
              <div className="text-muted-foreground text-xs mt-0.5">{f.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
