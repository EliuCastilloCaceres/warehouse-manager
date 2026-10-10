/** `BroadcastChannel` en memoria: `deliver` simula un mensaje de otra pestaña. */
export class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  static posted: { name: string; data: unknown }[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    FakeBroadcastChannel.posted.push({ name: this.name, data });
  }

  close(): void {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((c) => c !== this);
  }

  static deliver(name: string, data: unknown): void {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel.name === name) channel.onmessage?.({ data } as MessageEvent);
    }
  }

  static reset(): void {
    FakeBroadcastChannel.instances = [];
    FakeBroadcastChannel.posted = [];
  }
}
