import { RouterProvider } from "react-router";
import { router } from "@/app/router";
import { AppProvider } from "@/app/providers/AppProvider";

/**
 * Root Application Component
 * Responsibility: Wires the React Router into the Global Providers.
 * What not to do: Do not add layout divs here. That belongs in MainLayout.
 */
function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}

export default App;
