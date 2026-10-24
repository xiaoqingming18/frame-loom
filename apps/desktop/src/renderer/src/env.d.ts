declare const __APP_VERSION__: string;

interface Window {
  frameLoom: {
    getEngineConnection(): Promise<unknown>;
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
