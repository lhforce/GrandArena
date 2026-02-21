/**
 * Home - Main page orchestrating the 3-screen flow
 * Screen 1: Wallet input
 * Screen 2: Scheme card gallery
 * Screen 3: Champions for selected scheme
 */

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import WalletScreen from '@/components/WalletScreen';
import SchemesScreen from '@/components/SchemesScreen';
import ChampionsScreen from '@/components/ChampionsScreen';
import { SchemeCard, AppScreen, GameData } from '@/lib/types';

export default function Home() {
  const [screen, setScreen] = useState<AppScreen>('wallet');
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedScheme, setSelectedScheme] = useState<SchemeCard | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState('');

  // Load game data on mount
  useEffect(() => {
    setLoadingData(true);
    fetch('/game-data.json')
      .then(r => r.json())
      .then((data: GameData) => {
        setGameData(data);
        setLoadingData(false);
      })
      .catch(err => {
        console.error('Failed to load game data:', err);
        setDataError('Failed to load game data. Please refresh the page.');
        setLoadingData(false);
      });
  }, []);

  const handleWalletSubmit = (address: string) => {
    setWalletAddress(address);
    setScreen('schemes');
  };

  const handleSchemeSelect = (scheme: SchemeCard) => {
    setSelectedScheme(scheme);
    setScreen('champions');
  };

  const handleBackToWallet = () => {
    setScreen('wallet');
    setSelectedScheme(null);
  };

  const handleBackToSchemes = () => {
    setScreen('schemes');
    setSelectedScheme(null);
  };

  if (loadingData) {
    return (
      <div className="min-h-screen arena-bg flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-gold mx-auto mb-4" />
          <p className="text-muted-foreground">Loading Grand Arena data...</p>
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="min-h-screen arena-bg flex items-center justify-center">
        <div className="text-center text-destructive">
          <p className="text-lg font-medium">{dataError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg text-sm"
            style={{ background: 'oklch(0.78 0.16 85)', color: 'oklch(0.12 0.02 260)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!gameData) return null;

  return (
    <>
      {screen === 'wallet' && (
        <WalletScreen onWalletSubmit={handleWalletSubmit} />
      )}
      {screen === 'schemes' && (
        <SchemesScreen
          schemes={gameData.schemes}
          walletAddress={walletAddress}
          onSchemeSelect={handleSchemeSelect}
          onBack={handleBackToWallet}
        />
      )}
      {screen === 'champions' && selectedScheme && (
        <ChampionsScreen
          scheme={selectedScheme}
          walletAddress={walletAddress}
          onBack={handleBackToSchemes}
        />
      )}
    </>
  );
}
