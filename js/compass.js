// compass.js — Device orientation / compass heading module

let _compassCallback = null;
let _compassStarted = false;

/**
 * Request iOS 13+ permission for DeviceOrientationEvent.
 * Must be called from a user gesture (button tap).
 * Returns true if granted, false if denied or not needed.
 */
export async function requestCompassPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      return response === 'granted';
    } catch (e) {
      console.warn('Compass permission error:', e);
      return false;
    }
  }
  return true; // Android / desktop — no permission needed
}

/**
 * Start listening to compass heading changes.
 * Prefers deviceorientationabsolute (Android), falls back to deviceorientation.
 * callback(heading: number) — heading in degrees (0=North, 90=East, etc.)
 */
export function startCompass(callback) {
  _compassCallback = callback;
  if (_compassStarted) return;

  const handler = (e) => {
    let heading = null;

    // Prefer absolute orientation (reliable on Android)
    if (e.alpha !== null) {
      if (e.webkitCompassHeading !== undefined) {
        // iOS Safari — already gives compass heading directly
        heading = e.webkitCompassHeading;
      } else {
        // Android — alpha is degrees from North, counterclockwise → flip it
        heading = (360 - e.alpha) % 360;
      }
    }

    if (heading !== null && _compassCallback) {
      _compassCallback(heading);
    }
  };

  // Try absolute first (Chrome Android), fallback to regular
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handler, true);
  } else {
    window.addEventListener('deviceorientation', handler, true);
  }

  _compassStarted = true;
}

/**
 * Stop the compass listener
 */
export function stopCompass() {
  _compassCallback = null;
  _compassStarted = false;
}
