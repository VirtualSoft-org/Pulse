export {};
const sigInput = document.getElementById('sig') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const log = document.getElementById('log') as HTMLTextAreaElement;
const msgInput = document.getElementById('msg') as HTMLInputElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;

const pcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws: WebSocket | null = null;
let pc: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
const id: string = 'client-' + Math.random().toString(36).slice(2, 8);

function appendLog(s: string): void {
  log.value += s + '\n';
  log.scrollTop = log.scrollHeight;
}

connectBtn.onclick = async () => {
  if (ws) ws.close();
  ws = new WebSocket(sigInput.value);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'register', id }));
    appendLog('Connected to signaling server as ' + id);
    void createOffer();
  };

  ws.onmessage = async (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as any;
    const { type, from, data } = msg;
    if (type === 'registered') return;
    if (type === 'answer') {
      appendLog('Received answer from ' + from);
      if (pc) await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
    }
    if (type === 'ice') {
      try { if (pc) await pc.addIceCandidate(data as RTCIceCandidateInit); } catch (e) { console.warn(e); }
    }
  };
};

async function createOffer(): Promise<void> {
  pc = new RTCPeerConnection(pcConfig);
  pc.onicecandidate = (e) => {
    if (e.candidate && ws) ws.send(JSON.stringify({ type: 'ice', from: id, to: 'host', data: e.candidate }));
  };

  channel = pc.createDataChannel('p2p');
  channel.onopen = () => appendLog('DataChannel open');
  channel.onmessage = (m: MessageEvent) => appendLog('Received: ' + m.data);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (ws) ws.send(JSON.stringify({ type: 'offer', from: id, to: 'host', data: pc.localDescription }));
  appendLog('Sent offer to host');
}

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text || !channel || channel.readyState !== 'open') return;
  channel.send(text);
  appendLog('[me] ' + text);
  msgInput.value = '';
};
