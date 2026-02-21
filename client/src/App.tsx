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
import Settings from "@/pages/Settings";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/contests" component={Contests} />
        <Route path="/winning-lineups" component={WinningLineups} />
        <Route path="/lineup-builder" component={LineupBuilder} />
        <Route path="/my-cards" component={MyCards} />
        <Route path="/champion-stats">
          <PlaceholderPage title="Champion Stats" description="Performance rankings and stats from GATracker data." />
        </Route>
        <Route path="/telegram-alerts">
          <PlaceholderPage title="Telegram Alerts" description="Configure alerts for new contests and filling contests." />
        </Route>
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gold">{title}</h1>
        <p className="text-muted-foreground text-sm mt-1">{description}</p>
      </div>
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <p>Coming soon — this feature is being built.</p>
      </div>
    </div>
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
