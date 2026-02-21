/**
 * Settings — User configuration for wallet, gem budget, and Telegram alerts.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Wallet,
  Gem,
  Bell,
  Save,
  Settings as SettingsIcon,
  ExternalLink,
  User,
} from "lucide-react";

export default function Settings() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.lineup.settings.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const updateMutation = trpc.lineup.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Settings saved");
      utils.lineup.settings.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const [walletAddress, setWalletAddress] = useState("");
  const [dailyGemBudget, setDailyGemBudget] = useState("5000");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);

  // Populate form when settings load
  useEffect(() => {
    if (settingsQuery.data) {
      setWalletAddress(settingsQuery.data.walletAddress ?? "");
      setDailyGemBudget(String(settingsQuery.data.dailyGemBudget ?? 5000));
      setTelegramChatId(settingsQuery.data.telegramChatId ?? "");
      setTelegramEnabled(settingsQuery.data.telegramAlertsEnabled ?? false);
    }
  }, [settingsQuery.data]);

  const handleSave = () => {
    updateMutation.mutate({
      walletAddress: walletAddress || undefined,
      dailyGemBudget: Number(dailyGemBudget) || 5000,
      telegramChatId: telegramChatId || undefined,
      telegramAlertsEnabled: telegramEnabled,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure your account preferences
          </p>
        </div>
        <Card className="glass-card border-gold/20">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <SettingsIcon className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground">Please log in to manage your settings.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure your wallet, budget, and alert preferences
        </p>
      </div>

      {/* Account Info */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-gold" />
            Account
          </CardTitle>
          <CardDescription>Your Manus account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="text-sm font-medium">{user?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{user?.email ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Settings */}
      <Card className="glass-card border-teal/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-4 h-4 text-teal" />
            Ronin Wallet
          </CardTitle>
          <CardDescription>
            Your Ronin wallet address for fetching card inventory from the marketplace
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wallet">Wallet Address</Label>
            <Input
              id="wallet"
              placeholder="0x55c26Db6b037eF38179d75Ed3bbCB07b06fFC1e7"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="font-wallet text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Enter your Ronin wallet address to sync your Grand Arena card inventory.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Gem Budget */}
      <Card className="glass-card border-gold/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gem className="w-4 h-4 text-gold" />
            Daily Gem Budget
          </CardTitle>
          <CardDescription>
            Set your maximum daily spending on contest entries (100 gems = $1 USD)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="budget">Daily Budget (gems)</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              max={100000}
              value={dailyGemBudget}
              onChange={(e) => setDailyGemBudget(e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>= ${(Number(dailyGemBudget) / 100).toFixed(2)} USD/day</span>
              <span>= ${((Number(dailyGemBudget) / 100) * 30).toFixed(2)} USD/month</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Telegram Alerts */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal" />
            Telegram Alerts
          </CardTitle>
          <CardDescription>
            Get notified when new contests go live or contests are filling up fast
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Alerts</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Receive Telegram notifications for contest updates
              </p>
            </div>
            <Switch
              checked={telegramEnabled}
              onCheckedChange={setTelegramEnabled}
            />
          </div>

          {telegramEnabled && (
            <div className="space-y-2">
              <Label htmlFor="telegram">Telegram Chat ID</Label>
              <Input
                id="telegram"
                placeholder="1598083307"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Message @userinfobot on Telegram to get your chat ID.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="bg-gold text-background hover:bg-gold/90 px-8"
        >
          {updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
