import { createContext, useContext } from 'react'

// Sidecar context — provides call, notify, connected to all components
export const SidecarContext = createContext<{
  call?: (method: string, params?: any) => Promise<any>
  notify?: (method: string, params?: any) => void
  connected?: boolean
}>({})

export function useSidecarContext() {
  return useContext(SidecarContext)
}
