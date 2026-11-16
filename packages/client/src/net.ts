// WebSocket-Verbindung zum Server

type Handler = (m: any) => void;
const handlers = new Map<string, Set<Handler>>();
let ws: WebSocket | null = null;
let queue: string[] = [];
let onReconnect: (() => void) | null = null;

export function connect(reconnectHook?: () => void) {
  if (reconnectHook) onReconnect = reconnectHook;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    for (const q of queue) ws!.send(q);
    queue = [];
    onReconnect?.();
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    handlers.get(m.type)?.forEach((h) => h(m));
    handlers.get('*')?.forEach((h) => h(m));
  };
  ws.onclose = () => {
    emitLocal({ type: 'disconnected' });
    setTimeout(() => connect(), 2000);
  };
}

function emitLocal(m: any) {
  handlers.get(m.type)?.forEach((h) => h(m));
}

export function send(m: any) {
  const s = JSON.stringify(m);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
  else queue.push(s);
}

export function on(type: string, h: Handler) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(h);
}
