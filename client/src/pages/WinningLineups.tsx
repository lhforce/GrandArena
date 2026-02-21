/**
 * Winning Lineups — Shows AI-identified winning lineup combinations from completed contests.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trophy, Sparkles, Crown, Loader2 } from "lucide-react";
import { useState } from "react";

const RARITY_OPTIONS = [
  { value: "all", label: "All Contest Types" },
  { value: "OPEN", label: "Open" },
  { value: "COMMON_ONLY", label: "Common Only" },
  { value: "RARE_ONLY", label: "Rare Only" },
  { value: "EPIC_ONLY", label: "Epic Only" },
  { value: "LEGENDARY_ONLY", label: "Legendary Only" },
  { value: "ONE_OF_EACH", label: "One-Of-Each" },
  { value: "NO_LEGENDARY", label: "No Legendary" },
];

const FORMAT_OPTIONS = [
  { value: "all", label: "All Formats" },
  { value: "FIFTY_FIFTY", label: "50/50" },
  { value: "TOP_20_PCT", label: "Top 20%" },
  { value: "FREE_ENTRY", label: "Free Entry" },
];

export default function WinningLineups() {
  const [rarity, setRarity] = useState("all");
  const [format, setFormat] = useState("all");

  const { data, isLoading } = trpc.contests.winningLineups.useQuery({
    rarityRestriction: rarity === "all" ? undefined : rarity,
    format: format === "all" ? undefined : format,
    limit: 30,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold">Winning Lineups</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI-identified champion combinations from top contest placements
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={rarity} onValueChange={setRarity}>
          <SelectTrigger className="w-full sm:w-48 glass-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RARITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="w-full sm:w-40 glass-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      ) : data && data.length > 0 ? (
        <div className="space-y-4">
          {data.map((entry, idx) => (
            <WinningLineupCard key={entry.entryId} entry={entry} index={idx} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="mb-2">No identified winning lineups yet.</p>
          <p className="text-sm">
            Run the contest scraper and AI identification from the Dashboard to populate this data.
          </p>
        </div>
      )}
    </div>
  );
}

function WinningLineupCard({ entry, index }: { entry: any; index: number }) {
  const champions = (entry.identifiedChampions as any[]) ?? [];
  const confidence = Number(entry.aiConfidence ?? 0);
  const payout = Number(entry.estimatedPayout ?? 0);

  const rarityBadgeClass: Record<string, string> = {
    Basic: "bg-rarity-basic text-rarity-basic",
    Rare: "bg-rarity-rare text-rarity-rare",
    Epic: "bg-rarity-epic text-rarity-epic",
    Legendary: "bg-rarity-legendary text-rarity-legendary",
  };

  return (
    <Card className="glass-card hover:border-gold/20 transition-colors">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center shrink-0">
              {entry.rank <= 3 ? (
                <Crown className="w-4 h-4 text-gold" />
              ) : (
                <span className="text-sm font-bold text-gold">#{entry.rank}</span>
              )}
            </div>
            <div>
              <p className="font-semibold">{entry.contestName}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <Badge variant="outline" className="text-xs">
                  {entry.contestFormat === "FIFTY_FIFTY" ? "50/50" : entry.contestFormat === "TOP_20_PCT" ? "Top 20%" : "Free"}
                </Badge>
                {entry.rarityRestriction && entry.rarityRestriction !== "OPEN" && (
                  <Badge variant="outline" className="text-xs">
                    {entry.rarityRestriction.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-gold font-bold">{entry.score.toLocaleString()} pts</p>
            {payout > 0 && (
              <p className="text-xs text-muted-foreground">${(payout / 100).toFixed(2)} payout</p>
            )}
          </div>
        </div>

        {/* Champion Cards */}
        <div className="flex flex-wrap gap-2 mb-2">
          {champions.map((champ: any, i: number) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                champ.rarity === "Legendary"
                  ? "border-gold/40 bg-gold/5"
                  : champ.rarity === "Epic"
                    ? "border-purple-400/40 bg-purple-400/5"
                    : champ.rarity === "Rare"
                      ? "border-blue-400/40 bg-blue-400/5"
                      : "border-border/50 bg-background/50"
              }`}
            >
              <span className="text-sm font-medium">{champ.name}</span>
              <Badge className={`text-xs ${rarityBadgeClass[champ.rarity] ?? "bg-muted"} border-0`}>
                {champ.rarity}
              </Badge>
            </div>
          ))}
        </div>

        {/* Scheme + Confidence */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {entry.identifiedScheme && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-gold" />
                Scheme: <strong className="text-foreground">{entry.identifiedScheme}</strong>
              </span>
            )}
          </div>
          <span className={`${confidence >= 0.8 ? "text-green-400" : confidence >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
            {(confidence * 100).toFixed(0)}% confidence
          </span>
        </div>

        {/* Card Images (thumbnails) */}
        {entry.cardImages && (entry.cardImages as string[]).length > 0 && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border/30">
            {(entry.cardImages as string[]).map((url: string, i: number) => (
              <img
                key={i}
                src={url}
                alt={`Card ${i + 1}`}
                className="w-12 h-12 rounded-md object-cover border border-border/30"
                loading="lazy"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
