export {};
const sigInput = document.getElementById('sig') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const peerList = document.getElementById('peerList') as HTMLUListElement;
const log = document.getElementById('log') as HTMLTextAreaElement;
const msgInput = document.getElementById('msg') as HTMLInputElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;

const pcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws: WebSocket | null = null;
const peers = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel | null }>();

function appendLog(s: string): void {
  log.value += s + '\n';
  log.scrollTop = log.scrollHeight;
}

connectBtn.onclick = () => {
  if (ws) ws.close();
  ws = new WebSocket(sigInput.value);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'register', id: 'host' }));
    appendLog('Connected to signaling server');
  };

  ws.onmessage = async (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as any;
    const { type, from, data } = msg;
    if (type === 'registered') return;

    if (type === 'offer') {
      appendLog('Received offer from ' + from);
      await handleOffer(from, data);
    }
    if (type === 'ice' && peers.has(from)) {
      const candidate = data as RTCIceCandidateInit;
      try { await peers.get(from)!.pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
    }
  };
};

async function handleOffer(id: string, offer: any): Promise<void> {
  const pc = new RTCPeerConnection(pcConfig);
  // create a placeholder entry so ICE candidates can be applied before the datachannel opens
  peers.set(id, { pc, channel: null });

  pc.onicecandidate = (e) => {
    if (e.candidate && ws) ws.send(JSON.stringify({ type: 'ice', from: 'host', to: id, data: e.candidate }));
  };

  pc.ondatachannel = (ev: RTCDataChannelEvent) => {
    const channel = ev.channel;
    channel.onopen = () => { appendLog('DataChannel open: ' + id); updatePeerList(); };
    channel.onmessage = (m: MessageEvent) => {
      appendLog(`From ${id}: ${m.data}`);
      // forward to all other peers
      for (const [otherId, p] of peers.entries()) {
        if (otherId !== id && p.channel && p.channel.readyState === 'open') p.channel.send(`[${id}] ${m.data}`);
      }
    };
    const entry = peers.get(id) || { pc, channel: null };
    entry.channel = channel;
    peers.set(id, entry);
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      // cleanup peer entry
      if (peers.has(id)) {
        const p = peers.get(id)!;
        try { p.pc.close(); } catch (e) { /* ignore */ }
        peers.delete(id);
        appendLog('Peer removed: ' + id + ' (' + state + ')');
        updatePeerList();
      }
    }
  };

  await pc.setRemoteDescription(offer as RTCSessionDescriptionInit);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  if (ws) ws.send(JSON.stringify({ type: 'answer', from: 'host', to: id, data: pc.localDescription }));

  updatePeerList();
}

function updatePeerList(): void {
  peerList.innerHTML = '';
  for (const [id, p] of peers.entries()) {
    const li = document.createElement('li');
    const status = p.channel ? p.channel.readyState : 'pending';
    li.textContent = id + ' — ' + status;
    peerList.appendChild(li);
  }
}

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text) return;
  appendLog('[host] ' + text);
  for (const [, p] of peers.entries()) {
    if (p.channel && p.channel.readyState === 'open') p.channel.send(`[host] ${text}`);
  }
  msgInput.value = '';
<<<<<<< HEAD
};
=======
};
>>>>>>> 8283f660ccb411c4c467816c683900c3b1d899ec
