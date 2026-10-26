declare const __APP_VERSION__: string;

interface Window {
  frameLoom: {
    preferences: {
      get(): Promise<unknown>;
      set(value: import('@frame-loom/contracts').DesktopPreferencesUpdate): Promise<unknown>;
    };
    pickDirectory(value: import('@frame-loom/contracts').PickDirectoryRequest): Promise<unknown>;
    project: {
      reveal(value: import('@frame-loom/contracts').ProjectRevealRequest): Promise<void>;
      trash(value: import('@frame-loom/contracts').ProjectTrashRequest): Promise<void>;
    };
    getEngineConnection(): Promise<unknown>;
    onEngineExited(callback: (code: unknown) => void): () => void;
    theme: {
      get(): Promise<unknown>;
      set(source: import('@frame-loom/contracts').ThemeSource): Promise<unknown>;
    };
    window: {
      command(name: import('@frame-loom/contracts').WindowCommand): Promise<void>;
      isMaximized(): Promise<unknown>;
      onMaximizedChanged(callback: (maximized: unknown) => void): () => void;
    };
  };
}
