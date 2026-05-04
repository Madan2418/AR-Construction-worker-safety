// gps.js — GPS / Geolocation wrapper module

let _watchId = null;

/**
 * Start watching GPS position.
 * callback(lat: number, lng: number, accuracy: number)
 * errorCallback(err: GeolocationPositionError) — optional
 */
export function startGPS(callback, errorCallback) {
  if (!navigator.geolocation) {
    if (errorCallback) errorCallback(new Error('Geolocation not supported'));
    return;
  }

  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
  }

  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      callback(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.accuracy
      );
    },
    (err) => {
      console.error('GPS error:', err.message);
      if (errorCallback) errorCallback(err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,       // allow cache up to 2s old
      timeout: 10000          // give up after 10s
    }
  );
}

/**
 * Stop GPS watching
 */
export function stopGPS() {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
}

/**
 * Get a single GPS fix (one-shot).
 * Returns a Promise<{lat, lng, accuracy}>
 */
export function getGPSOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}
