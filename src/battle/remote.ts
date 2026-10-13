/**
 * The big screen's side of a game played on phones: it opens a room on the server, keeps who sits where,
 * receives what the phones want to do and sends them pictures of the game.
 */
import { ReconnectingSocket } from '../net/socket';
import { SEATS, type HostToPhone, type Intent } from '../net/protocol';

export interface Seat {
  cid: string;
  name: string;
  drink: string;
}

export interface RemoteHandlers {
  onIntent: (cid: string, intent: Intent) => void;
  /** A phone came or went, or the link to the server changed. */
  onChange: () => void;
}

export class RemoteHost {
  room = '';
  online = false;
  /** Seat i (0 to SEATS - 1) is held by a phone, or free. */
  seats: Array<Seat | null> = Array.from({ length: SEATS }, () => null);
  private token = '';
  private phones = new Set<string>();
  private sock: ReconnectingSocket;

  constructor(private handlers: RemoteHandlers) {
    this.sock = new ReconnectingSocket(
      () => ({ t: 'host', room: this.room || undefined, token: this.token || undefined }),
      (m) => this.onMessage(m),
      (online) => {
        this.online = online;
        this.handlers.onChange();
      },
    );
  }

  private onMessage(m: Record<string, unknown>): void {
    if (m.t === 'hosted') {
      this.room = String(m.room);
      this.token = String(m.token);
      this.handlers.onChange();
    } else if (m.t === 'peer') {
      const cid = String(m.cid);
      if (m.on) this.phones.add(cid);
      else this.phones.delete(cid);
      this.handlers.onChange();
    } else if (m.t === 'c2h') {
      this.handlers.onIntent(String(m.cid), m.msg as Intent);
    }
  }

  isConnected(cid: string): boolean {
    return this.phones.has(cid);
  }

  seatOf(cid: string): number {
    return this.seats.findIndex((s) => s?.cid === cid);
  }

  broadcast(msg: HostToPhone): void {
    this.sock.send({ t: 'h2c', to: 'all', msg });
  }

  sendTo(cid: string, msg: HostToPhone): void {
    this.sock.send({ t: 'h2c', to: cid, msg });
  }

  close(): void {
    this.sock.close();
  }
}
