import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { CanvasRecord, type CanvasSaveRequest, type CanvasView } from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { canvasDocuments } from './canvas.schema.js';

@Injectable()
export class CanvasRepository {
  constructor(private readonly database: DatabaseService) {}

  load(id: string): CanvasRecord | null {
    const row = this.database.db
      .select()
      .from(canvasDocuments)
      .where(eq(canvasDocuments.id, id))
      .get();
    return row
      ? CanvasRecord.parse({
          id: row.id,
          revision: row.revision,
          document: row.document,
          view: row.view,
          updatedAt: row.updatedAt,
        })
      : null;
  }

  save(id: string, { revision, document }: CanvasSaveRequest) {
    const db = this.database.db;
    const now = new Date().toISOString();
    // 条件写入让 revision 检查与落盘成为同一个原子操作，不留读后写窗口。
    const result =
      revision === 0
        ? db
            .insert(canvasDocuments)
            .values({
              id,
              title: id === 'lab' ? '画布测试' : id,
              schemaVersion: document.schemaVersion,
              revision: 1,
              document,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run()
        : db
            .update(canvasDocuments)
            .set({
              schemaVersion: document.schemaVersion,
              revision: revision + 1,
              document,
              updatedAt: now,
            })
            .where(and(eq(canvasDocuments.id, id), eq(canvasDocuments.revision, revision)))
            .run();
    if (!result.changes)
      throw new DomainError(
        'CANVAS_REVISION_CONFLICT',
        409,
        '其他窗口已修改画布，请重新加载或导出当前画布',
      );
    return { revision: revision + 1 };
  }

  saveView(id: string, view: CanvasView) {
    const result = this.database.db
      .update(canvasDocuments)
      .set({ view })
      .where(eq(canvasDocuments.id, id))
      .run();
    if (!result.changes) throw new DomainError('CANVAS_NOT_FOUND', 404, '画布尚未创建');
    return { saved: true as const };
  }
}
