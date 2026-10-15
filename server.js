const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'Arithmos' }));

function hand() { return Array.from({ length: 7 }, (_, i) => [i + 1, i + 1]).flat(); }
function safeName(value, fallback) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
  return name || fallback;
}
function validPlayerId(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 100; }
function countOf(arr, n) { return arr.filter(x => x === n).length; }
function validPick(player, nums) {
  if (!player || !Array.isArray(nums) || nums.length !== 2) return false;
  const wanted = {};
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 1 || n > 7) return false;
    wanted[n] = (wanted[n] || 0) + 1;
  }
  return Object.entries(wanted).every(([n, count]) => countOf(player.hand, Number(n)) >= count);
}
function removePicks(arr, picks) {
  const copy = [...arr];
  for (const n of picks) {
    const i = copy.indexOf(n);
    if (i >= 0) copy.splice(i, 1);
  }
  return copy;
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
function findPlayerSlot(room, playerId) {
  for (const slot of ['A', 'B']) if (room.players[slot]?.playerId === playerId) return slot;
  return null;
}
function publicRoom(room, viewerSlot) {
  const revealed = room.status === 'revealed' || room.status === 'finished';
  const submissions = {};
  for (const slot of ['A', 'B']) {
    const sub = room.submissions[slot];
    if (!sub) continue;
    submissions[slot] = revealed ? { nums: [...sub.nums], submittedAt: sub.submittedAt } : { submittedAt: sub.submittedAt };
  }
  return {
    status: room.status,
    round: room.round,
    players: {
      A: room.players.A ? { name: room.players.A.name, hand: [...room.players.A.hand], score: room.players.A.score } : null,
      B: room.players.B ? { name: room.players.B.name, hand: [...room.players.B.hand], score: room.players.B.score } : null
    },
    submissions,
    history: room.history.map(h => ({ round: h.round, submissions: { A: { nums: [...h.submissions.A.nums] }, B: { nums: [...h.submissions.B.nums] } }, sums: { ...h.sums }, winner: h.winner }))
  };
}
function sendRoom(room) {
  for (const slot of ['A', 'B']) {
    const player = room.players[slot];
    if (!player?.socketId) continue;
    io.to(player.socketId).emit('state', { code: room.code, slot, room: publicRoom(room, slot) });
  }
}
function responseRoom(room, slot) { return { code: room.code, slot, room: publicRoom(room, slot) }; }
function ackError(ack, error) { if (typeof ack === 'function') ack({ ok: false, error }); }

function aiPick(room, style, difficulty) {
  const hand = room.players.B.hand;
  const pairs = [];
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) {
    const nums = [hand[i], hand[j]].sort((a, b) => a - b);
    const sum = nums[0] + nums[1];
    const max = Math.max(...nums);
    const remaining = removePicks(hand, nums);
    const value = (sum * 1.0) + max * 0.15 - remaining.length * 0.01;
    pairs.push({ nums, sum, max, value });
  }
  if (!pairs.length) return [];
  if (style === 'random') return pairs[Math.floor(Math.random() * pairs.length)].nums;
  const human = room.players.A.hand;
  const humanPairs = [];
  for (let i = 0; i < human.length; i++) for (let j = i + 1; j < human.length; j++) humanPairs.push(human[i] + human[j]);
  const target = humanPairs.length ? humanPairs[Math.floor(humanPairs.length / 2)] : 8;
  for (const p of pairs) {
    const pressure = p.sum > target ? 2 : -2;
    p.value = style === 'aggressive' ? p.sum * 1.6 + p.max * 0.7 + pressure
      : style === 'defensive' ? -Math.abs(p.sum - target) * 1.3 + p.max * 0.15
      : p.sum + pressure + p.max * 0.25;
  }
  pairs.sort((a, b) => b.value - a.value);
  const pool = difficulty === 'easy' ? pairs.slice(Math.max(0, pairs.length - Math.ceil(pairs.length * 0.65))) : difficulty === 'normal' ? pairs.slice(0, Math.max(1, Math.ceil(pairs.length * 0.4))) : pairs.slice(0, Math.max(1, Math.ceil(pairs.length * 0.15)));
  return pool[Math.floor(Math.random() * pool.length)].nums;
}
function submitAI(room) {
  if (!room.ai || room.status !== 'playing' || room.submissions.B) return;
  room.submissions.B = { nums: aiPick(room, room.ai.style, room.ai.difficulty), submittedAt: Date.now() };
  resolveRound(room);
}

function resolveRound(room) {
  if (room.status !== 'playing' || !room.submissions.A || !room.submissions.B) return;
  const a = room.submissions.A.nums;
  const b = room.submissions.B.nums;
  if (!validPick(room.players.A, a) || !validPick(room.players.B, b)) {
    room.status = 'finished';
    room.endReason = 'A submission did not match the available inventory.';
    return;
  }
  const sumA = a[0] + a[1];
  const sumB = b[0] + b[1];
  room.players.A.hand = removePicks(room.players.A.hand, a);
  room.players.B.hand = removePicks(room.players.B.hand, b);
  room.players.A.hand.push(Math.max(...b));
  room.players.B.hand.push(Math.max(...a));
  if (sumA > sumB) room.players.A.score++;
  else if (sumB > sumA) room.players.B.score++;
  room.history.push({
    round: room.round,
    submissions: { A: { nums: [...a] }, B: { nums: [...b] } },
    sums: { A: sumA, B: sumB },
    winner: sumA > sumB ? 'A' : sumB > sumA ? 'B' : 'tie'
  });
  if (room.players.A.score >= 7 || room.players.B.score >= 7) room.status = 'finished';
  else if (room.players.A.hand.length < 2 || room.players.B.hand.length < 2) room.status = 'finished';
  else room.status = 'revealed';
}

io.on('connection', socket => {
  socket.on('createRoom', (data = {}, ack) => {
    if (!validPlayerId(data.playerId)) return ackError(ack, 'Could not identify this browser. Refresh and try again.');
    let code;
    for (let i = 0; i < 20; i++) { code = makeCode(); if (!rooms.has(code)) break; }
    if (rooms.has(code)) return ackError(ack, 'Could not find a free room code. Please try again.');
    const room = {
      code, status: 'waiting', round: 1,
      players: {
        A: { playerId: data.playerId, socketId: socket.id, name: safeName(data.name, 'Player A'), hand: hand(), score: 0 },
        B: null
      },
      submissions: {}, history: [], createdAt: Date.now()
    };
    rooms.set(code, room);
    if (typeof ack === 'function') ack({ ok: true, ...responseRoom(room, 'A') });
    sendRoom(room);
  });


  socket.on('createAIRoom', (data = {}, ack) => {
    if (!validPlayerId(data.playerId)) return ackError(ack, 'Could not identify this browser. Refresh and try again.');
    let code;
    for (let i = 0; i < 20; i++) { code = makeCode(); if (!rooms.has(code)) break; }
    if (rooms.has(code)) return ackError(ack, 'Could not find a free room code. Please try again.');
    const style = ['aggressive', 'smart', 'defensive', 'random'].includes(data.style) ? data.style : 'smart';
    const difficulty = ['easy', 'normal', 'hard'].includes(data.difficulty) ? data.difficulty : 'normal';
    const room = {
      code, status: 'playing', round: 1, ai: { style, difficulty },
      players: {
        A: { playerId: data.playerId, socketId: socket.id, name: safeName(data.name, 'Player'), hand: hand(), score: 0 },
        B: { playerId: 'ai-' + code, socketId: null, name: 'Arithmos AI', hand: hand(), score: 0 }
      },
      submissions: {}, history: [], createdAt: Date.now()
    };
    rooms.set(code, room);
    submitAI(room);
    if (typeof ack === 'function') ack({ ok: true, ...responseRoom(room, 'A') });
    sendRoom(room);
  });

  socket.on('joinRoom', (data = {}, ack) => {
    const code = String(data.code || '').toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return ackError(ack, 'Enter the 6-character room code.');
    if (!validPlayerId(data.playerId)) return ackError(ack, 'Could not identify this browser. Refresh and try again.');
    const room = rooms.get(code);
    if (!room || room.status !== 'waiting' || room.players.B) return ackError(ack, 'Room not found, already full, or the match has already started. Check the code.');
    if (room.players.A.playerId === data.playerId) return ackError(ack, 'Open the game in a different browser or device to join your own room.');
    room.players.B = { playerId: data.playerId, socketId: socket.id, name: safeName(data.name, 'Player B'), hand: hand(), score: 0 };
    room.status = 'playing';
    if (typeof ack === 'function') ack({ ok: true, ...responseRoom(room, 'B') });
    sendRoom(room);
  });

  socket.on('reconnectRoom', (data = {}, ack) => {
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room || !validPlayerId(data.playerId)) return ackError(ack, 'This room is no longer active. Create a new room.');
    const slot = findPlayerSlot(room, data.playerId);
    if (!slot) return ackError(ack, 'This browser is not a player in that room.');
    room.players[slot].socketId = socket.id;
    if (typeof ack === 'function') ack({ ok: true, ...responseRoom(room, slot) });
    sendRoom(room);
  });

  socket.on('submitChoices', (data = {}, ack) => {
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return ackError(ack, 'Room not found. Create a new match.');
    const slot = findPlayerSlot(room, data.playerId);
    if (!slot || room.players[slot].socketId !== socket.id) return ackError(ack, 'Your player session is no longer active. Reopen the room.');
    if (room.status !== 'playing') return ackError(ack, 'This round is not accepting choices.');
    if (room.submissions[slot]) return ackError(ack, 'Your choices are already locked in.');
    const nums = Array.isArray(data.nums) ? data.nums : [];
    if (!validPick(room.players[slot], nums)) return ackError(ack, 'Choose two numbers that are still in your inventory.');
    room.submissions[slot] = { nums: [...nums].sort((a, b) => a - b), submittedAt: Date.now() };
    if (room.ai && slot === 'A') submitAI(room);
    resolveRound(room);
    if (typeof ack === 'function') ack({ ok: true });
    sendRoom(room);
  });

  socket.on('nextRound', (data = {}, ack) => {
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return ackError(ack, 'Room not found.');
    const slot = findPlayerSlot(room, data.playerId);
    if (!slot || room.players[slot].socketId !== socket.id) return ackError(ack, 'Your player session is no longer active.');
    if (room.status === 'revealed') {
      room.round++;
      room.submissions = {};
      room.status = 'playing';
      if (room.ai) submitAI(room);
      sendRoom(room);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('leaveRoom', (data = {}) => {
    const room = rooms.get(String(data.code || '').toUpperCase());
    if (!room) return;
    const slot = findPlayerSlot(room, data.playerId);
    if (slot && room.players[slot].socketId === socket.id) room.players[slot].socketId = null;
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      for (const slot of ['A', 'B']) {
        if (room.players[slot]?.socketId === socket.id) room.players[slot].socketId = null;
      }
    }
  });
});

// Keep the in-memory prototype tidy; matches expire four hours after creation.
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.createdAt < cutoff) rooms.delete(code);
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Arithmos listening on port ${PORT}`));
