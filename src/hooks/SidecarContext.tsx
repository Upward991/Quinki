// SidecarContext.tsx — Provides call/notify to any component
import { createContext, useContext } from "react";

interface SidecarContextValue {
  call: (method: string, params?: any) => Promise<any>;
  notify: (method: string, params?: any) => void;
  connected: boolean;
}

export const SidecarContext = createContext<SidecarContextValue>({
  call: async () => { throw new Error("SidecarContext not provided"); },
  notify: () => {},
  connected: false,
});

export function useSidecarCall() {
  return useContext(SidecarContext);
}
