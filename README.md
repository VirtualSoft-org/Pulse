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


## ✨ What's inside

**🎬 Local playback**  
Play your own copy directly on your device. Any format your browser handles — 16:9, 4:3, 21:9, or vertical phone clips — renders at its native shape, no stretching.

**⏯️ Synchronized controls**  
Play, pause, and seek together. Seeking rebroadcasts on release, so the whole room jumps to the same moment without flooding the network during a drag.

**👑 Host lock**  
The first person in the room is host. Only the host can play, pause, or seek. Everyone keeps their own volume, mute, and fullscreen. The host can hand the role to anyone else by clicking the 👑 pill. If the host leaves — or transfers and then leaves — the next-oldest member takes over automatically.

**👥 Watch rooms**  
Bring everyone into the same session. Presence tracks members, ready state, and host role per tab — multiple tabs in the same browser count as separate users.

**💬 Room chat**  
Talk while you watch.

**📺 Fullscreen chat**  
Messages pop in over the fullscreen video. Swipe them away, or pull down the handle in the top-right to type — Enter sends and closes.

**📱 Mobile-first layout**  
Adapts to portrait and landscape, with a stacked layout on phones and a 16:9 or native-ratio video box. On Android, rotating to landscape requests fullscreen automatically.

**🎛️ Custom player**  
A lean control bar built for Pulse: play/pause, seek, time, mute, volume, fullscreen. No third-party player skin, no bloat.

**🎉 Reactions**  
Send an emoji mid-scene. It floats up on everyone's screen.

**🧪 One-time Sync · BETA**  
Different releases can have different offsets. Pulse can fingerprint the current scene and find the corresponding position to bring local copies back together.

**⚡ Lightweight by design**  
The server handles synchronization and communication — not your movie.

## 🔒 Your media stays local

Pulse only needs to exchange small pieces of information:

```text
PLAY      → timestamp
PAUSE     → state
SEEK      → timestamp
CHAT      → message
REACT     → emoji
PRESENCE  → name, ready, joinedAt
SYNC      → visual fingerprint (perceptual hash)
SNAP      → late-join position handshake
````

The actual movie never needs to pass through the Pulse server.



## 🧠 Why Pulse?

Watch parties shouldn't need to become streaming platforms.

If everyone already has the movie, there is no reason to send the entire movie through the internet just to keep four players synchronized.

Pulse focuses on the one thing that actually needs to be shared:

**where everyone is in the movie.**



## License

[GPL-3.0](https://github.com/VirtualSoft-org/Pulse/blob/main/LICENSE)