export interface Champion {
  championTokenId: string;
  name: string;
  image: string;
  rarity: string;
  tokenId: number;
  fur: string;
  is1of1: boolean;
  rarityImages?: Record<string, string | null>;
}

export interface SchemeCard {
  name: string;
  description: string;
  image: string;
  tokenId: string;
  hasTraitFilter: boolean;
  qualifyingChampionCount: number;
  qualifyingChampions: Champion[];
  hasMultiRarity?: boolean;
}

export interface GameData {
  schemes: SchemeCard[];
  champions: any[];
}

export interface FloorPrice {
  rarity: string;
  price: number | null;
  loading: boolean;
}

export interface WalletChampion {
  tokenId: number;
  name: string;
  championTokenId: string;
}

export type AppScreen = 'wallet' | 'schemes' | 'champions';

export const RARITY_ORDER = ['Basic', 'Rare', 'Epic', 'Legendary'];

export const RARITY_COLORS: Record<string, string> = {
  Basic: 'rarity-basic',
  Rare: 'rarity-rare',
  Epic: 'rarity-epic',
  Legendary: 'rarity-legendary',
};

export const RARITY_TEXT_COLORS: Record<string, string> = {
  Basic: 'text-rarity-basic',
  Rare: 'text-rarity-rare',
  Epic: 'text-rarity-epic',
  Legendary: 'text-rarity-legendary',
};
