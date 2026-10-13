/** A WebSocket that reconnects by itself and says "hello" again each time, so a phone that loses the network gets its seat back. */
export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private timer = 0;
  private wait = 800;
  private closed = false;

  constructor(
    private hello: () => object,
    private onMessage: (msg: Record<string, unknown>) => void,
    private onStatus: (online: boolean) => void,
    private url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  ) {
    this.open();
    // A phone that wakes up from sleep: reconnect now instead of waiting.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) this.reconnectNow();
    });
    window.addEventListener('online', () => this.reconnectNow());
  }

  private open(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.wait = 800;
      ws.send(JSON.stringify(this.hello()));
      this.onStatus(true);
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        this.onMessage(msg);
      } catch {
        /* ignore garbage */
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws === ws) {
        this.onStatus(false);
        this.schedule();
      }
    });
    ws.addEventListener('error', () => ws.close());
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), this.wait);
    this.wait = Math.min(this.wait * 1.6, 5000);
  }

  private reconnectNow(): void {
    window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.open();
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
  }
}
