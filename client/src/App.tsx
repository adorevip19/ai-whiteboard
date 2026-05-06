import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import WhiteboardPage from "@/pages/whiteboard";
import SharedPlayerPage from "@/pages/shared-player";
import GroupSharedPlayerPage from "@/pages/group-shared-player";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={WhiteboardPage} />
      <Route path="/share/:id" component={SharedPlayerPage} />
      <Route path="/group-share/:id" component={GroupSharedPlayerPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
