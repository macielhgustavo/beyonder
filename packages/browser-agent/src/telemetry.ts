import type { BrowserEventName, BrowserTelemetryEvent, BrowserTelemetrySink } from "./types.js";
import { redactTelemetryDetails } from "./redaction.js";

export class NoopBrowserTelemetrySink implements BrowserTelemetrySink {
  emit(): void {}
}

export class InMemoryBrowserTelemetrySink implements BrowserTelemetrySink {
  readonly events: BrowserTelemetryEvent[] = [];

  emit(event: BrowserTelemetryEvent): void {
    this.events.push(event);
  }
}

export async function emitBrowserEvent(
  sink: BrowserTelemetrySink,
  name: BrowserEventName,
  sessionId: string,
  details: Record<string, unknown> = {},
  actionId?: string
): Promise<void> {
  const event: BrowserTelemetryEvent = {
    name,
    timestamp: new Date().toISOString(),
    sessionId,
    details: redactTelemetryDetails(details)
  };
  if (actionId !== undefined) event.actionId = actionId;
  await sink.emit(event);
}
