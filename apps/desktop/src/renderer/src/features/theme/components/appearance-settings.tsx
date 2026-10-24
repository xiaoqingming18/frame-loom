import { ThemeSwitch } from './theme-switch';

export function AppearanceSettings() {
  return (
    <section aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="text-xl font-semibold">
        外观
      </h2>
      <div className="mt-9 flex flex-wrap items-center justify-between gap-5">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">主题</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            选择明亮、暗黑或跟随系统主题
          </p>
        </div>
        <ThemeSwitch />
      </div>
      <p className="mt-8 text-xs text-muted-foreground">外观偏好会自动保存在此设备。</p>
    </section>
  );
}
