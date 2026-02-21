/**
 * Telegram Alerts — Configuration and monitoring for contest notifications.
 * Allows users to:
 * - Test Telegram bot connection
 * - Start/stop contest monitoring
 * - Send manual summaries
 * - View monitoring status
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Send,
  Play,
  Square,
  Bell,
  BellOff,
  CheckCircle2,
  XCircle,
  Radio,
  MessageSquare,
  Calendar,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export default function TelegramAlerts() {
  const { data: status, isLoading, refetch } = trpc.telegram.status.useQuery();

  const sendTestMutation = trpc.telegram.sendTest.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Test message sent to Telegram!");
      } else {
        toast.error("Failed to send test message");
      }
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const startMonitorMutation = trpc.telegram.startMonitor.useMutation({
    onSuccess: () => {
      toast.success("Contest monitoring started! Checking every 5 minutes.");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const stopMonitorMutation = trpc.telegram.stopMonitor.useMutation({
    onSuccess: () => {
      toast.success("Contest monitoring stopped.");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const sendSummaryMutation = trpc.telegram.sendSummary.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Contest summary sent to Telegram!");
      } else {
        toast.error("Failed to send summary");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const isMonitorRunning = status?.monitorStatus?.running ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-gold">
          Telegram Alerts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Get notified when new contests go live or spots are running low
        </p>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bot Status</p>
                <div className="flex items-center gap-2">
                  {status?.configured ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-medium text-emerald-400">
                        Configured
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-400" />
                      <span className="text-sm font-medium text-red-400">
                        Not Configured
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Bell className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Monitor</p>
                <div className="flex items-center gap-2">
                  {isMonitorRunning ? (
                    <>
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span className="text-sm font-medium text-emerald-400">
                        Active
                      </span>
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-muted-foreground">
                        Inactive
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Zap className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tracked</p>
                <div className="text-xl font-bold text-foreground">
                  {status?.monitorStatus?.knownContests ?? 0}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  contests known &middot; {status?.monitorStatus?.alertedFilling ?? 0} filling alerts
                </p>
              </div>
              <MessageSquare className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Notice */}
      {!status?.configured && (
        <Card className="bg-amber-950/30 border-amber-600/30">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-200">
                  Telegram Bot Not Configured
                </p>
                <p className="text-xs text-amber-300/70 mt-1">
                  Go to <strong>Settings</strong> and enter your Telegram Chat ID.
                  The bot token and chat ID need to be configured as environment
                  variables (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Test Connection */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="w-4 h-4 text-gold" />
              Test Connection
            </CardTitle>
            <CardDescription className="text-xs">
              Send a test message to verify your Telegram bot is working
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => sendTestMutation.mutate()}
              disabled={sendTestMutation.isPending || !status?.configured}
              className="w-full bg-gold/20 text-gold border border-gold/30 hover:bg-gold/30"
              variant="outline"
            >
              {sendTestMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Test Message
            </Button>
          </CardContent>
        </Card>

        {/* Contest Summary */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-teal" />
              Contest Summary
            </CardTitle>
            <CardDescription className="text-xs">
              Send a summary of all upcoming contests to Telegram
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => sendSummaryMutation.mutate()}
              disabled={sendSummaryMutation.isPending || !status?.configured}
              className="w-full bg-teal/20 text-teal border border-teal/30 hover:bg-teal/30"
              variant="outline"
            >
              {sendSummaryMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Calendar className="w-4 h-4 mr-2" />
              )}
              Send Contest Summary
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Monitor Control */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="w-4 h-4 text-gold" />
            Contest Monitor
          </CardTitle>
          <CardDescription className="text-xs">
            Automatically check for new contests every 5 minutes and send alerts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="bg-background/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                New Contest Alerts
              </p>
              <p className="text-xs text-foreground">
                Notifies when a contest transitions to LIVE status
              </p>
            </div>
            <div className="bg-background/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Filling Fast Alerts
              </p>
              <p className="text-xs text-foreground">
                Warns when contests reach 75%+ capacity
              </p>
            </div>
            <div className="bg-background/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Check Interval
              </p>
              <p className="text-xs text-foreground">
                Every 5 minutes
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            {isMonitorRunning ? (
              <Button
                onClick={() => stopMonitorMutation.mutate()}
                disabled={stopMonitorMutation.isPending}
                variant="outline"
                className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                {stopMonitorMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                Stop Monitor
              </Button>
            ) : (
              <Button
                onClick={() => startMonitorMutation.mutate()}
                disabled={startMonitorMutation.isPending || !status?.configured}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {startMonitorMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Start Monitor
              </Button>
            )}
          </div>

          {isMonitorRunning && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 rounded-lg p-3">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Monitor is active. Checking for new contests every 5 minutes.
              {status?.monitorStatus?.knownContests
                ? ` Tracking ${status.monitorStatus.knownContests} known contests.`
                : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert Types Reference */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Alert Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-background/30 rounded-lg">
              <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 shrink-0">
                NEW
              </Badge>
              <div>
                <p className="text-sm font-medium text-foreground">
                  New Contest Live
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sent immediately when a contest transitions from OPEN/DRAFT to
                  LIVE. Includes contest name, format, entry fee, prize pool, and
                  rarity restrictions.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-background/30 rounded-lg">
              <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 shrink-0">
                FILLING
              </Badge>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Contest Filling Fast
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sent when a LIVE contest reaches 75% capacity. Includes spots
                  remaining and fill percentage. Escalates to red alert at 90%.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-background/30 rounded-lg">
              <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 shrink-0">
                SUMMARY
              </Badge>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Contest Summary
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manual summary of all upcoming OPEN contests with start times,
                  entry fees, and prize pools. Send on demand via the button above.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
