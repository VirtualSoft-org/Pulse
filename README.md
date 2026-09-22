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
Play your own copy directly on your device. Any format your browser handles — 16:9, 4:3, 21:9, or vertical phone clips — renders at its native shape, no stretching. Unsupported containers and stalled loads get a clear warning instead of a frozen black box.

**⏯️ Synchronized controls**  
Play, pause, and seek together. Seeking rebroadcasts on release, so the whole room jumps to the same moment without flooding the network during a drag.

**👑 Host lock**  
The first person in the room is host. Only the host can play, pause, or seek. Everyone keeps their own volume, mute, and fullscreen. The host can hand the role to anyone else by clicking the 👑 pill. If the host leaves — or transfers and then leaves — the next-oldest member takes over automatically.

**👥 Watch rooms**  
Bring everyone into the same session. Presence tracks members, ready state, and host role per tab — multiple tabs in the same browser count as separate users.

**🔗 Invite links**  
Click **Invite** to copy a link that pre-fills the room and passphrase. The passphrase rides in the URL hash, so it never leaves the browser — not in referrers, not in server logs.

**💬 Room chat**  
Talk while you watch. Avatars from your profile URL appear next to each message.

**📺 Fullscreen chat**  
Messages pop in over the fullscreen video. Swipe them away, or pull down the handle in the top-right to type — Enter sends and closes.

**🎉 Reactions**  
Send an emoji mid-scene. It floats up on everyone's screen. In fullscreen, a pull-down handle in the top-left gives you quick access.

**📱 Mobile-first layout**  
Adapts to portrait and landscape. On Android, rotating to landscape requests fullscreen automatically.

**🎛️ Fullscreen gestures**  
MX Player-style swipes: left half controls brightness, right half controls volume, and a horizontal swipe anywhere scrubs ±90 seconds. Axis locks on first movement, so a slightly diagonal drag doesn't fight itself. On iOS the volume gesture shows an honest "use volume buttons" hint instead of a slider that does nothing.

**🎛️ Custom player**  
A lean control bar built for Pulse: play/pause, seek, time, mute, volume, fullscreen. Auto-hides during playback, reappears on movement. No third-party player skin, no bloat.

**💬 Soft subtitles**  
Load `.srt`, `.vtt`, `.ass`, or `.ssa` files alongside your video. SRT and VTT get full style controls — size, colour, background opacity, font, vertical position, shadow. ASS/SSA renders with its own styling via ASS.js. Style settings persist locally.

**👤 Profiles**  
Set a display name and optional avatar URL at join. Avatars appear in the topbar and beside chat messages. Images are sanitized before use.

**📶 Resilient connection**  
Backgrounded tabs, WiFi switches, and silent socket drops are all detected within a few seconds and reconnected automatically. When you come back, the client re-snaps to the room's current position.

**📲 Installable**  
Ships as a PWA. Install from your browser's menu for a home-screen icon and a standalone window that skips the browser chrome.

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
HOST      → transfer
PRESENCE  → name, avatar, ready, joinedAt
SYNC      → visual fingerprint (perceptual hash)
SNAP      → late-join position handshake
```

The actual movie never needs to pass through the Pulse server.


## 🧠 Why Pulse?

Watch parties shouldn't need to become streaming platforms.

If everyone already has the movie, there is no reason to send the entire movie through the internet just to keep four players synchronized.

Pulse focuses on the one thing that actually needs to be shared:

**where everyone is in the movie.**


## 💡 If a video won't play

Pulse can't decode what your browser can't decode. A few things to check:

**1. MP4 without faststart.**  
If a file loads slowly or hangs, its seek index (`moov`) is probably at the end. Remux it — no re-encode, ~5 seconds:

```bash
ffmpeg -i "movie.mp4" -c copy -movflags +faststart "movie-fixed.mp4"
```

**2. MKV / AVI / WMV / FLV.**  
No browser plays these natively. Remux to MP4:

```bash
ffmpeg -i "movie.mkv" -c copy "movie.mp4"
```

**3. HEVC / H.265.**  
Safari plays it. Chrome partially. **Firefox often doesn't**, especially on Linux. If it won't play on one browser, try another, or re-encode to H.264.

**4. Very large files.**  
2 GB+ files are fine on desktops with plenty of RAM. On phones, stick under ~1.5 GB.

Pulse now sniffs the container before loading and warns you if any of the above are likely to bite.

## License

[GPL-3.0](https://github.com/VirtualSoft-org/Pulse/blob/main/LICENSE)