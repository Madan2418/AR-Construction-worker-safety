# AR Construction Safety Visualizer

> **"See the danger before you walk into it"**  
> Browser-based AR tool for construction sites. No native app, no build step — just a URL.

## Features

- 📍 **Manager Mode** — Place safety zones on a live camera feed (drag & drop)
- 🔍 **Worker Mode** — See zones overlaid on your camera in real-time via GPS + compass
- 🔴🟢🟡🔵 Four zone types: Danger, Safe Path, Restricted, Assembly
- 📡 Real-time sync via Firebase Realtime Database
- 📱 Full PWA — installable on Android & iOS
- 🧭 iOS 13+ DeviceOrientationEvent permission handling

---

## Setup

### 1. Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/) → Create project
2. Enable **Realtime Database** (start in test mode)
3. Enable **Authentication** (optional — for manager write protection)
4. Copy your config from Project Settings → Web App

### 2. Firebase Config

Edit `firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Firebase Security Rules

In the Firebase Console → Realtime Database → Rules:

```json
{
  "rules": {
    "zones": {
      ".read": true,
      ".write": true
    }
  }
}
```

> ⚠️ For production, restrict writes to authenticated managers only.

### 4. Run Locally (HTTPS Required)

Camera and DeviceOrientationEvent require HTTPS. Use one of:

**Option A — VS Code Live Server** (with HTTPS enabled)

**Option B — Node.js serve:**
```bash
npx serve . -l 3000
```
Then open on your phone via HTTPS (use ngrok or VS Code port forwarding).

**Option C — Python HTTPS:**
```bash
python -m http.server 8080
```
Then use ngrok for HTTPS: `ngrok http 8080`

### 5. Deploy to GitHub Pages (Recommended)

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/ar-safety.git
git push -u origin main
```

Enable GitHub Pages in repository Settings → Pages → `main` branch.  
Your app will be live at `https://YOUR_USERNAME.github.io/ar-safety/`

---

## File Structure

```
ar-safety/
├── index.html          # Mode selector landing page
├── manager.html        # Manager AR view
├── worker.html         # Worker AR view
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline support)
├── firebase-config.js  # Firebase initialization
├── js/
│   ├── camera.js       # getUserMedia setup
│   ├── compass.js      # DeviceOrientationEvent → heading
│   ├── gps.js          # watchPosition wrapper
│   ├── db.js           # Firebase read/write
│   ├── manager.js      # Drag-and-drop zone placement
│   └── worker.js       # Zone fetch + AR canvas overlay
├── css/
│   └── style.css       # All styles
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## How It Works

### Manager
1. Opens rear camera
2. Drags zone icon onto camera feed
3. GPS + compass captured at drop point
4. Zone written to Firebase → appears on all workers instantly

### Worker
1. Opens rear camera
2. App streams GPS + compass continuously
3. For each zone: `bearing = calculateBearing(myPos, zonePos)`
4. `angleDiff = bearing - myHeading` → maps to screen X
5. Distance determines zone size and vertical position
6. Danger zones pulse with red glow animation

---

## Known Limitations

| Limitation | Impact |
|---|---|
| GPS drift ±3-5m | Zone position can shift slightly |
| Compass needs ~5s calibration | Initial overlay may be off |
| No true AR depth | 2D overlays, no 3D perspective |
| Indoor GPS unreliable | Outdoor sites only |
| HTTPS required | DeviceOrientationEvent won't work on HTTP |

---

*Built by: Madankumar Senthilkumar (RA2311003010658) & Danielraj S (RA2311003010669)*  
*SRM Institute of Science and Technology*
