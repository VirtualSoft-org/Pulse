# WebRTC Star (Host + Client)

This example provides a simple WebRTC "star" topology: a single host acts as the hub and multiple clients connect to the host via WebRTC DataChannels. The host forwards messages between clients, creating a star-shaped P2P network.

Quick start:

1. Install dependencies and start the signaling server:

```bash
cd "webrtc-star"
npm install
npm start
```

2. Open `host/host.html` in a browser (or serve it via a local static server) and click Connect (host registers with id `host`).
3. Open one or more `client/client.html` pages and click Connect — each client will register and send an offer to the host. The host will answer and create a DataChannel with each client.

Notes:
- The signaling server runs on `ws://localhost:3000` by default. Change the URL in the pages if running elsewhere.
- This is a minimal demo: no authentication, no TURN servers, and no production signaling guarantees.
