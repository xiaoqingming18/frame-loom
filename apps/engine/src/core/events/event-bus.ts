import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { EngineEvent } from '@frame-loom/contracts';
import { Subject } from 'rxjs';

@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly subject = new Subject<EngineEvent>();
  readonly events = this.subject.asObservable();
  readonly closed = new Subject<void>();

  publish(event: EngineEvent): void {
    this.subject.next(EngineEvent.parse(event));
  }

  onModuleDestroy(): void {
    this.closed.next();
    this.closed.complete();
    this.subject.complete();
  }
}
