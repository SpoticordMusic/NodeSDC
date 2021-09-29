import { EventEmitter } from 'events';
import WebSocket from 'ws';
import Utils from "./Utils";
import zlib from 'zlib';
import { TokenManager } from './TokenManager';

export default class DealerClient extends EventEmitter {
  private readonly reqListeners: Map<string, RequestListener> = new Map<string, RequestListener>();
  private readonly msgListeners: Map<MessageListener, string[]> = new Map<MessageListener, string[]>();

  private conn: typeof DealerClient.ConnectionHolder.prototype;
  private lastScheduledReconnection: NodeJS.Timeout;

  public constructor(private readonly token: TokenManager) {
    super();
  }

  private static getHeaders(obj: any) {
    const map = new Map<string, string>();
    
    if (!obj.headers) return map;

    for (const key of Object.keys(obj.headers)) {
      map.set(key.toLowerCase(), obj.headers[key]);
    }

    return map;
  }

  public async connect() {    
    this.conn = new DealerClient.ConnectionHolder(this, `wss://gew-dealer.spotify.com/?access_token=${await this.token.retrieveToken()}`);
  }

  private handleRequest(obj: any) {
    const mid = obj.message_ident as string;
    const key = obj.key as string;

    const headers = DealerClient.getHeaders(obj);
    let payload = obj.payload;
    if (headers.get('transfer-encoding') === 'gzip') {
      const gzip = Buffer.from(payload.compressed, 'base64');
      payload = JSON.parse(zlib.gunzipSync(gzip).toString('utf8'));
    }

    const pid = payload['message_id'] as number;
    const sender = payload['sent_by_device_id'] as string;

    const command = payload['command'];

    for (const midPrefix of this.reqListeners.keys()) {
      if (mid.startsWith(midPrefix)) {
        const listener = this.reqListeners.get(midPrefix);
        setImmediate(() => {
          try {
            const result = listener.onRequest(mid, pid, sender, command);
            if (this.conn != null) this.conn.sendReply(key, result);
          } catch {
            if (this.conn != null) this.conn.sendReply(key, RequestResult.UPSTREAM_ERROR);
          }
        });
      }
    }
  }

  private handleMessage(obj: any) {
    const uri = obj.uri as string;

    const headers = DealerClient.getHeaders(obj);
    const payloads = obj.payloads;
    let decodedPayload: Buffer;
    if (payloads) {
      if (headers.get('content-type') === 'application/json') {
        if (payloads.length > 1) throw new Error('Unsupported');
        decodedPayload = Buffer.from(JSON.stringify(payloads[0]), 'utf8');
      } else if (headers.get('content-type') === 'text/plain') {
        if (payloads.length > 1) throw new Error('Unsupported');
        decodedPayload = Buffer.from(payloads[0], 'utf8');
      } else {
        const payloadsStr: string[] = payloads as string[];
        
        let buf = Utils.collapseByteList(payloadsStr.map(str => Buffer.from(str, 'base64')));
        if (headers.get('transfer-encoding') === 'gzip') {
          try {
            buf = zlib.gunzipSync(buf)
          } catch {
            return;
          }
        }

        decodedPayload = buf;
      }
    } else {
      decodedPayload = Buffer.alloc(0);
    }

    for (const listener of this.msgListeners.keys()) {
      let dispatched = false;
      const keys = this.msgListeners.get(listener);
      for (const key of keys) {
        if (uri.startsWith(key) && !dispatched) {
          setImmediate(() => {
            try {
              listener.onMessage(uri, headers, decodedPayload);
            } catch (ex) {

            }
          })
          dispatched = true;
        }
      }
    }
  }

  public addMessageListener(listener: MessageListener, ...uris: string[]) {
    if (this.msgListeners.has(listener))
      throw new Error(`A listener for ${Utils.format(uris)} has already been added.`);

    this.msgListeners.set(listener, uris);
  }

  public removeMessageListener(listener: MessageListener) {
    this.msgListeners.delete(listener);
  }

  public addRequestListener(listener: RequestListener, uri: string) {
    if (this.reqListeners.has(uri))
      throw new Error(`A listener for ${uri} has already been added.`);

    this.reqListeners.set(uri, listener);
  }

  public removeRequestListener(listener: RequestListener) {
    this.reqListeners.delete(Array.from(this.reqListeners.keys()).filter(v => this.reqListeners[v] === listener)[0]);
  }

  public close() {
    if (this.conn != null) {
      const tmp = this.conn;
      this.conn = null;
      tmp.close();
    }

    if (this.lastScheduledReconnection != null) {
      clearTimeout(this.lastScheduledReconnection);
      this.lastScheduledReconnection = null;
    }

    this.msgListeners.clear();
  }

  private connectionInvalidated() {
    this.emit('close');

    if (!this.conn) return;
    if (this.lastScheduledReconnection != null) throw new Error('Illegal State');
  
    this.conn = null;
  }

  private static ConnectionHolder = class extends EventEmitter {
    private ws: WebSocket;
    private closed: boolean = false;
    private receivedPong: boolean = false;
    private lastScheduledPing: NodeJS.Timeout;
  
    public constructor(private readonly dealer: DealerClient, url: string) {
      super();

      this.ws = new WebSocket(url);
  
      this.ws.onopen = this.onOpen.bind(this);
      this.ws.onmessage = this.onMessage.bind(this);
      this.ws.onerror = this.onFailure.bind(this);
      this.ws.onclose = this.onClose.bind(this);
    }
  
    private sendPing() {
      this.ws.send("{\"type\":\"ping\"}");
    }
  
    sendReply(key: string, result: RequestResult) {
      this.ws.send(JSON.stringify({
        type: 'reply',
        key,
        payload: {
          success: result == RequestResult.SUCCESS
        }
      }));
    }
  
    public close() {
      if (!this.closed) {
        this.closed = true;
        this.ws.close(1000);
      }
  
      if (this.lastScheduledPing != null) {
        clearInterval(this.lastScheduledPing);
        this.lastScheduledPing = null;
      }
  
      this.dealer.connectionInvalidated();
    }
  
    private onOpen(ev: WebSocket.OpenEvent) {
      if (this.closed) return;
  
      this.lastScheduledPing = setInterval(() => {
        this.sendPing();
        this.receivedPong = false;
  
        setTimeout(() => {
          if (this.lastScheduledPing == null) return;
  
          if (!this.receivedPong) {
            this.close();
            return;
          }
  
          this.receivedPong = false;
        }, 3000);
      }, 30000);
    }
  
    private onMessage(data: WebSocket.MessageEvent) {
      const obj = JSON.parse(data.data as string);
  
      switch (obj.type as string) {
        case 'message':
          this.dealer.handleMessage(obj);
          break;
  
        case 'request':
          this.dealer.handleRequest(obj);
          break;
  
        case 'pong':
          this.receivedPong = true;
          break;
  
        case 'ping':
          break;
  
        default:
          throw new Error(`Unknown message type for ${obj.type}`);
      }
    }
  
    private onFailure(ev: WebSocket.ErrorEvent) {
      if (this.closed) return;
  
      this.close();
    }

    private onClose() {
      if (this.closed) return;

      this.close();
    }
  }
}

export interface RequestListener {
  onRequest:(mid: string, pid: number, sender: string, command: any) => RequestResult;
}

export interface MessageListener {
  onMessage:(uri: string, headers: Map<string, string>, payload: Buffer) => void;
}

export enum RequestResult {
  UNKNOWN_SEND_COMMAND_RESULT, SUCCESS,
  DEVICE_NOT_FOUND, CONTEXT_PLAYER_ERROR,
  DEVICE_DISAPPEARED, UPSTREAM_ERROR,
  DEVICE_DOES_NOT_SUPPORT_COMMAND, RATE_LIMITED
}