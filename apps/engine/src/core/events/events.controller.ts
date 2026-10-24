import { Controller, Sse, type MessageEvent } from '@nestjs/common';
import { map, merge, takeUntil, timer, type Observable } from 'rxjs';
import { EventBus } from './event-bus.js';

@Controller('events')
export class EventsController {
  constructor(private readonly bus: EventBus) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    return merge(
      this.bus.events,
      timer(0, 15_000).pipe(
        map(() => ({ type: 'heartbeat' as const, timestamp: new Date().toISOString() })),
      ),
    ).pipe(
      map((data) => ({ data })),
      takeUntil(this.bus.closed),
    );
  }
}
