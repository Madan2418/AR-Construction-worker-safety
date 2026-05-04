# AR Construction Safety Visualizer — Architecture

> **Tagline:** "See the danger before you walk into it"  
> **Stack:** Vanilla JS + HTML5 Canvas + WebAPIs — no framework, no install, runs in any mobile browser

---

## What This App Does

A browser-based AR tool for construction sites. A **Manager** places safety zone markers on a live camera feed. A **Worker** opens the same app and sees those zones overlaid in real-time on their camera using GPS + compass to compute position and orientation.

No native app. No server-side rendering. Just a URL.

---

## Two Roles, One App

```
Manager Mode
  → Opens camera
  → Drags zone icons onto live video (danger, safe path, restricted, assembly)
  → Saves: GPS coords + bearing + zone type → database

Worker Mode
  → Opens camera
  → App fetches all zones from database
  → Computes where each zone should appear on screen (GPS + compass)
  → Draws colored overlays on canvas in real-time
```

---

## Zone Types

| Zone | Color | Meaning |
|------|-------|---------|
| Danger | 🔴 Red | Active hazard — do not enter |
| Safe Path | 🟢 Green | Walk here |
| Restricted | 🟡 Yellow | Authorized personnel only |
| Assembly | 🔵 Blue | Emergency meeting point |

---

## Tech Stack

| Layer | What to Use |
|-------|-------------|
| Camera | `getUserMedia({ video: true })` → `<video>` element |
| Canvas overlay | `<canvas>` positioned absolutely on top of `<video>` |
| GPS | `navigator.geolocation.watchPosition()` |
| Compass | `DeviceOrientationEvent` → `alpha` (compass heading) |
| Database | Firebase Realtime DB (free tier, real-time sync via WebSocket) |
| Hosting | GitHub Pages or Firebase Hosting (HTTPS required for camera/GPS) |
| Frontend | HTML + CSS + Vanilla JS (single `index.html`) |

No React. No build step. Keep it simple.

---

## File Structure

```
ar-safety/
├── index.html          # Entry point — mode selector (Manager / Worker)
├── manager.html        # Manager view
├── worker.html         # Worker view
├── js/
│   ├── camera.js       # getUserMedia setup, shared by both views
│   ├── compass.js      # DeviceOrientationEvent → heading in degrees
│   ├── gps.js          # watchPosition wrapper
│   ├── db.js           # Firebase read/write (zones)
│   ├── manager.js      # Drag-and-drop zone placement logic
│   └── worker.js       # Zone fetch + canvas overlay rendering
├── css/
│   └── style.css
└── firebase-config.js  # Firebase init (public config, secured by rules)
```

---

## Data Model (Firebase)

```json
zones/{zoneId}: {
  "type": "danger" | "safe" | "restricted" | "assembly",
  "lat": 12.9716,
  "lng": 77.5946,
  "bearing": 142.5,       // compass direction manager was facing when placed
  "screenX": 0.45,        // normalized 0-1 position on screen (for display reference)
  "screenY": 0.60,
  "timestamp": 1712000000,
  "placedBy": "manager-1"
}
```

Firebase Security Rules: Allow reads by anyone, writes only with a manager auth token.

---

## How Zone Placement Works (Manager)

1. Camera feed plays in `<video>` tag
2. Canvas overlays the video (same size, `position: absolute`)
3. Manager long-presses or taps a zone icon → drags it onto the camera view
4. On drop: capture current GPS + compass heading → save to Firebase
5. Visual confirmation: colored circle appears on canvas at drop point

```
Manager taps "Danger" icon
  → starts dragging
  → drops on camera feed at (x, y)
  → read GPS: (lat, lng)
  → read compass: heading
  → write to Firebase: { type: danger, lat, lng, bearing: heading, screenX: x/W, screenY: y/H }
```

---

## How Zone Display Works (Worker)

1. Camera feed plays
2. GPS + compass update continuously
3. Every ~500ms: fetch zones from Firebase (or use real-time listener)
4. For each zone: compute angular offset between worker's heading and zone's bearing + GPS direction
5. Map that offset to a screen X position
6. Draw colored overlay on canvas at computed position

```
Zone is at (zoneLat, zoneLng)
Worker is at (myLat, myLng), facing heading 90°

→ bearing to zone = calculateBearing(myPos, zonePos)  // e.g. 95°
→ angleDiff = bearing - heading = 5°                   // zone is 5° to the right
→ screenX = centerX + (angleDiff / FOV) * screenWidth  // map to pixels
→ draw red circle at screenX, screenY
```

Field of view (FOV) assumption: ~60° horizontal for mobile cameras.

---

## Key Functions to Build

### `camera.js`
```js
async function startCamera(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' }  // rear camera
  });
  videoElement.srcObject = stream;
}
```

### `compass.js`
```js
function startCompass(callback) {
  window.addEventListener('deviceorientationabsolute', (e) => {
    const heading = 360 - e.alpha;  // convert to compass heading
    callback(heading);
  });
}
```

### `gps.js`
```js
function startGPS(callback) {
  navigator.geolocation.watchPosition(
    (pos) => callback(pos.coords.latitude, pos.coords.longitude),
    (err) => console.error(err),
    { enableHighAccuracy: true }
  );
}
```

### `worker.js` — bearing calculation
```js
function calculateBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
```

---

## UI — Manager View

```
┌─────────────────────────────┐
│  [Live Camera Feed]         │
│                             │
│   [🔴]  [🟢]  [🟡]  [🔵]  ← drag these onto the feed
│                             │
│  GPS: 12.97, 77.59  ✓      │
│  Compass: 142°  ✓           │
└─────────────────────────────┘
```

- Zone icons sit below the camera feed
- Drag a zone icon → drop on camera → saves immediately
- Status bar shows GPS/compass lock status

## UI — Worker View

```
┌─────────────────────────────┐
│  [Live Camera Feed]         │
│                             │
│        🔴  ← overlaid zone  │
│                             │
│   🟢                        │
└─────────────────────────────┘
```

- Zones appear as colored circles with labels
- No interaction needed from worker — view only

---

## Known Limitations (be upfront)

| Limitation | Impact |
|---|---|
| GPS drift ±3-5m | Zone position can shift slightly |
| Compass needs calibration (~5s) | Initial overlay may be off |
| No true AR depth | Zones are 2D overlays, no 3D perspective |
| Indoor GPS unreliable | App is for outdoor sites only |
| DeviceOrientationEvent needs HTTPS | Must host on HTTPS (GitHub Pages works) |

---

## Build Order (Recommended)

1. `index.html` — mode selector page
2. `camera.js` — get camera working on mobile
3. `gps.js` + `compass.js` — verify sensor data in console
4. `manager.html` + `manager.js` — drag/drop + Firebase write
5. `db.js` — Firebase setup + zone schema
6. `worker.html` + `worker.js` — fetch zones + bearing calc
7. Canvas overlay rendering
8. Polish UI + add zone labels + color legend

---

## Performance Targets

| Metric | Target |
|---|---|
| Manager zone placement | < 30 seconds |
| Worker overlay load time | 2–3 seconds |
| GPS accuracy | ±3–5m |
| Compass calibration | ~5 seconds |
| Platform support | Android + iOS (Safari requires permission prompt) |

---

## iOS-Specific Note

On iOS 13+, `DeviceOrientationEvent` requires explicit user permission:

```js
if (typeof DeviceOrientationEvent.requestPermission === 'function') {
  await DeviceOrientationEvent.requestPermission();
}
```

Trigger this on a button tap — cannot call on page load.

---

*Built by: Madankumar Senthilkumar (RA2311003010658) & Danielraj S (RA2311003010669)*
