import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-auto">
        <DialogHeader>
          <DialogTitle>剧本快捷键</DialogTitle>
          <DialogDescription>组字期间快捷键不处理，Enter 用于提交输入法候选。</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm">
          {[
            [
              'Enter',
              '段落中间拆分并保持类型；末尾按幕→场、角色→对白、括注→对白、转场→场，其余→动作新建段落。非动作空段改为动作。',
            ],
            [
              'Tab / Shift+Tab',
              '仅空段循环：动作→角色→对白→括注→场→转场→音效→字幕→注释→人物→幕；非空段保留焦点。',
            ],
            ['Ctrl+1～9', '场、动作、角色、括注、对白、音效、字幕、转场、注释。'],
            [
              '场标题识别',
              '动作段末尾 Enter 识别带时间或内外标记的场标题；角色段末尾 Enter 识别 OS、VO、画外音、旁白、内心。',
            ],
            [
              '人物补全',
              '角色段输入名称或别名，方向键选择，Enter 确认；新建人物在保存时同步为待确认。',
            ],
            ['Backspace', '段落开头与上一段合并。'],
            ['Ctrl+Z', '撤销'],
            ['Ctrl+Shift+Z / Ctrl+Y', '重做'],
            ['Alt+↑ / Alt+↓', '移动当前段落'],
            ['粘贴多行', '按行拆分并保持当前类型；场标题后拆为动作。'],
          ].map(([key, description]) => (
            <div key={key}>
              <dt className="font-medium">{key}</dt>
              <dd className="mt-1 text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
