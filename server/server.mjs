/**
 * Candy Cascade, local multiplayer server.
 *
 *   npm run build   (once, and after any change to the game)
 *   npm run play    (starts this server)
 *
 * It does three small things:
 *  1. serves the built game (dist/) to the big screen and to the phones,
 *  2. keeps rooms: the big screen creates one, phones join it with the code (or the QR code),
 *  3. relays messages between the big screen (which runs the game) and the phones (the controllers),
 *     remembers the last picture of the game so a phone that reconnects sees it at once,
 *     and tells the big screen when a phone leaves or comes back.
 *
 * It holds no game rules: the big screen owns the game state, so the whole thing fits in a hundred lines
 * and moves to any host that runs Node (see README, "Héberger en ligne").
 */
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
/** Phones open the controller over HTTPS on this port: the motion sensors (sword duel) only work on secure pages. */
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const CERT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.cert');
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

/**
 * A certificate made on this computer for its own addresses (the phones will ask once whether to trust it).
 * It is kept in server/.cert and made again when the computer's addresses change. Returns null when openssl is missing.
 */
function ensureCert(ips) {
  const keyFile = path.join(CERT_DIR, 'key.pem');
  const crtFile = path.join(CERT_DIR, 'cert.pem');
  const metaFile = path.join(CERT_DIR, 'ips.json');
  const wanted = JSON.stringify([...ips].sort());
  try {
    if (fs.existsSync(keyFile) && fs.existsSync(crtFile) && fs.readFileSync(metaFile, 'utf8') === wanted) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(crtFile) };
    }
  } catch {
    /* make a new one */
  }
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const alt = ['DNS.1 = localhost', 'IP.1 = 127.0.0.1', ...ips.map((ip, i) => `IP.${i + 2} = ${ip}`)].join('\n');
    const cnf = `[req]\ndistinguished_name = dn\nx509_extensions = v3\nprompt = no\n[dn]\nCN = Candy Cascade\n[v3]\nsubjectAltName = @alt\nbasicConstraints = CA:FALSE\nkeyUsage = digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\n[alt]\n${alt}\n`;
    const cnfFile = path.join(CERT_DIR, 'openssl.cnf');
    fs.writeFileSync(cnfFile, cnf);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', '397', '-config', cnfFile], { stdio: 'ignore' });
    fs.writeFileSync(metaFile, wanted);
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(crtFile) };
  } catch {
    return null;
  }
}

const tls = process.env.NO_TLS ? null : ensureCert(lanAddresses());

const handle = (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ips: lanAddresses(), port: PORT, httpsPort: tls ? HTTPS_PORT : null }));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found. Did you run "npm run build"?');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
};

const server = http.createServer(handle);
const secureServer = tls ? https.createServer(tls, handle) : null;

/** @type {Map<string, {host: import('ws').WebSocket|null, token: string, phones: Map<string, import('ws').WebSocket|null>, last: object|null, touched: number}>} */
const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O: easy to read out loud
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(code)) return code;
  }
}

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

const wss = new WebSocketServer({ noServer: true });
for (const srv of [server, secureServer]) {
  srv?.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

wss.on('connection', (ws) => {
  /** @type {{role: 'host'|'phone', code: string, cid?: string} | null} */
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'host') {
      let room = typeof m.room === 'string' ? rooms.get(m.room) : undefined;
      let code = m.room;
      if (!room || room.token !== m.token) {
        code = newCode();
        room = { host: null, token: crypto.randomBytes(12).toString('hex'), phones: new Map(), last: null, touched: Date.now() };
        rooms.set(code, room);
      }
      if (room.host && room.host !== ws) room.host.close();
      room.host = ws;
      room.touched = Date.now();
      me = { role: 'host', code };
      send(ws, { t: 'hosted', room: code, token: room.token });
      for (const [cid, phone] of room.phones) send(ws, { t: 'peer', cid, on: !!phone });
      return;
    }

    if (m.t === 'join') {
      const code = String(m.room ?? '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'Salle introuvable. Vérifie le code.' });
      let cid = typeof m.cid === 'string' && room.phones.has(m.cid) ? m.cid : null;
      if (!cid) {
        if (room.phones.size >= 24) return send(ws, { t: 'error', msg: 'Salle pleine.' });
        cid = crypto.randomBytes(8).toString('hex');
      }
      const old = room.phones.get(cid);
      if (old && old !== ws) old.close();
      room.phones.set(cid, ws);
      room.touched = Date.now();
      me = { role: 'phone', code, cid };
      send(ws, { t: 'joined', cid, room: code });
      if (room.last) send(ws, { t: 'h2c', msg: room.last });
      send(room.host, { t: 'peer', cid, on: true });
      return;
    }

    const room = me ? rooms.get(me.code) : undefined;
    if (!room || !me) return;
    room.touched = Date.now();

    if (me.role === 'phone' && m.t === 'c2h') {
      send(room.host, { t: 'c2h', cid: me.cid, msg: m.msg });
    } else if (me.role === 'host' && m.t === 'h2c') {
      const type = m.msg?.type;
      if (m.to === 'all') {
        if (type === 'lobby' || type === 'sync') room.last = m.msg;
        for (const phone of room.phones.values()) send(phone, { t: 'h2c', msg: m.msg });
      } else {
        send(room.phones.get(m.to), { t: 'h2c', msg: m.msg });
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
    const room = rooms.get(me.code);
    if (!room) return;
    if (me.role === 'host' && room.host === ws) room.host = null;
    if (me.role === 'phone' && room.phones.get(me.cid) === ws) {
      room.phones.set(me.cid, null); // keep the seat: the same phone can come back with its id
      send(room.host, { t: 'peer', cid: me.cid, on: false });
    }
  });
});

// Drop dead connections, and rooms nobody touched for hours.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) if (!room.host && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
}, 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nCandy Cascade tourne sur le port ${PORT}`);
  console.log(`  Grand écran : http://localhost:${PORT}/`);
  for (const ip of lanAddresses()) console.log(`  Téléphones  : http://${ip}:${PORT}/  (le QR code de la salle l'utilise tout seul)`);
  if (!secureServer) console.log("  HTTPS indisponible (openssl introuvable) : les gestes de sabre ne marcheront pas, les boutons oui.");
  console.log('');
});
secureServer?.listen(HTTPS_PORT, '0.0.0.0', () => {
  for (const ip of lanAddresses()) console.log(`  Téléphones en HTTPS (gestes de sabre) : https://${ip}:${HTTPS_PORT}/  (accepte l'avertissement du certificat)`);
  console.log('');
});
