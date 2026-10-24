import { contextBridge, ipcRenderer } from 'electron';
import type { ThemeSource, WindowCommand } from '@frame-loom/contracts';

contextBridge.exposeInMainWorld('frameLoom', {
  getEngineConnection: (): Promise<unknown> => ipcRenderer.invoke('engine:connection'),
  theme: {
    get: (): Promise<unknown> => ipcRenderer.invoke('theme:get'),
    set: (source: ThemeSource): Promise<unknown> => ipcRenderer.invoke('theme:set', source),
  },
  window: {
    command: (name: WindowCommand): Promise<void> => ipcRenderer.invoke('window:command', name),
  },
});
