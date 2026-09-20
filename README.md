<div align="center">

# 🎬 Pulse

### Watch together. Without streaming.

**A local-first watch party that keeps everyone's movie on their own device.**

<br>

**[🌐 PULSE](https://virtualsoft-org.github.io/Pulse/)**

</div>


## 🍿 The idea

You already have the movie.  
Your friends already have the movie.

So Pulse doesn't stream it.

Everyone plays their own local copy while Pulse keeps the room synchronized.

**Your movie stays with you. The timeline is shared.**

---

## ✨ What's inside

**🎬 Local playback**  
Play your own copy directly on your device.

**⏯️ Synchronized controls**  
Play, pause, and seek together.

**👥 Watch rooms**  
Bring everyone into the same session.

**💬 Room chat**  
Talk while you watch.

**🧪 One-time Sync · BETA**  
Different releases can have different offsets. Pulse can use the current scene to find the corresponding position and bring local copies back together.

**⚡ Lightweight by design**  
The server handles synchronization and communication — not your movie.

## 🔒 Your media stays local

Pulse only needs to exchange small pieces of information:

```text
PLAY  → timestamp
PAUSE → state
SEEK  → timestamp
CHAT  → message
SYNC  → visual fingerprint
````

The actual movie never needs to pass through the Pulse server.

---

## 🧠 Why Pulse?

Watch parties shouldn't need to become streaming platforms.

If everyone already has the movie, there is no reason to send the entire movie through the internet just to keep four players synchronized.

Pulse focuses on the one thing that actually needs to be shared:

**where everyone is in the movie.**

---

## 🚧 Status

**Early development**

Pulse is experimental and actively being built.

## License

[GPL-3.0](https://github.com/VirtualSoft-org/Pulse/blob/main/LICENSE)