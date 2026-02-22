import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import DashboardLayout from "@/components/DashboardLayout";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Contests from "@/pages/Contests";
import WinningLineups from "@/pages/WinningLineups";
import LineupBuilder from "@/pages/LineupBuilder";
import MyCards from "@/pages/MyCards";
import ChampionStats from "@/pages/ChampionStats";
import TelegramAlerts from "@/pages/TelegramAlerts";
import Settings from "@/pages/Settings";
import MatchupIntel from "@/pages/MatchupIntel";
import SwapAdvisor from "@/pages/SwapAdvisor";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/contests" component={Contests} />
        <Route path="/winning-lineups" component={WinningLineups} />
        <Route path="/lineup-builder" component={LineupBuilder} />
        <Route path="/my-cards" component={MyCards} />
        <Route path="/champion-stats" component={ChampionStats} />
        <Route path="/telegram-alerts" component={TelegramAlerts} />
        <Route path="/matchup-intel" component={MatchupIntel} />
        <Route path="/swap-advisor" component={SwapAdvisor} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
