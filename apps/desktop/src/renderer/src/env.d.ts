interface Window {
  frameLoom: {
    getEngineConnection(): Promise<unknown>;
    theme: {
      get(): Promise<unknown>;
      set(source: import('@frame-loom/contracts').ThemeSource): Promise<unknown>;
    };
    window: { command(name: import('@frame-loom/contracts').WindowCommand): Promise<void> };
  };
}
