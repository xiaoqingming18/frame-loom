import { Info, Palette, Server } from 'lucide-react';
import logo from '@/assets/logo.png';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppearanceSettings } from '@/features/theme/components/appearance-settings';
import { EngineStatusPanel } from '@/features/engine-status/components/engine-status-panel';
import type { EngineClient } from '@/lib/engine-client';
import { settingsTab, type SettingsTab } from './settings-search';

export function SettingsDialog({
  tab,
  onTabChange,
  engineClient,
}: {
  tab?: SettingsTab;
  onTabChange: (tab?: SettingsTab) => void;
  engineClient: EngineClient;
}) {
  return (
    <Dialog
      open={!!tab}
      onOpenChange={(open) => {
        if (!open) onTabChange();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-3rem)] w-[calc(100%-2rem)] overflow-y-auto bg-card sm:max-w-[720px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById('settings-button')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>设置中心</DialogTitle>
          <DialogDescription>管理工作台外观，查看本地引擎与应用信息。</DialogDescription>
        </DialogHeader>
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={(value) => onTabChange(settingsTab.parse(value))}
          className="min-h-72 gap-6"
        >
          <TabsList aria-label="设置分类" className="w-32 shrink-0 gap-1 bg-transparent p-0">
            <TabsTrigger value="appearance" className="px-3 py-2.5">
              <Palette />
              外观
            </TabsTrigger>
            <TabsTrigger value="engine" className="px-3 py-2.5">
              <Server />
              本地引擎
            </TabsTrigger>
            <TabsTrigger value="about" className="px-3 py-2.5">
              <Info />
              关于
            </TabsTrigger>
          </TabsList>
          <TabsContent value="appearance" className="min-w-0 border-l pl-6">
            <AppearanceSettings />
          </TabsContent>
          <TabsContent value="engine" className="min-w-0 border-l pl-6">
            <EngineStatusPanel engineClient={engineClient} />
          </TabsContent>
          <TabsContent value="about" className="min-w-0 border-l pl-6">
            <section
              aria-labelledby="about-heading"
              className="flex flex-col items-center pt-6 text-center"
            >
              <img src={logo} alt="帧织 logo" className="mb-4 size-16 rounded-2xl" />
              <h2 id="about-heading" className="font-serif text-xl">
                帧织 · Frame Loom
              </h2>
              <p className="mt-2 text-muted-foreground">影视创作工作台</p>
              <p className="mt-6 text-xs text-muted-foreground">
                应用版本 <span data-testid="app-version">{__APP_VERSION__}</span>
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
