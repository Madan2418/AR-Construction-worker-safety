// db.js — Firebase Realtime Database operations for AR Safety Visualizer

import { db } from '../firebase-config.js';
import {
  ref,
  push,
  onValue,
  off,
  remove,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const ZONES_PATH = 'zones';

/**
 * Write a new zone to Firebase.
 * Returns the generated zone key.
 */
export async function addZone(zoneData) {
  const zonesRef = ref(db, ZONES_PATH);
  const newRef = await push(zonesRef, {
    ...zoneData,
    timestamp: Date.now()
  });
  return newRef.key;
}

/**
 * Listen to all zones in real-time.
 * callback(zones: Array<{id, type, lat, lng, bearing, screenX, screenY, timestamp, placedBy}>)
 * Returns an unsubscribe function.
 */
export function listenToZones(callback) {
  const zonesRef = ref(db, ZONES_PATH);

  const listener = onValue(zonesRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      callback([]);
      return;
    }
    const zones = Object.entries(data).map(([id, zone]) => ({
      id,
      ...zone
    }));
    callback(zones);
  });

  // Return cleanup function
  return () => off(zonesRef, 'value', listener);
}

/**
 * Delete a zone by its ID.
 */
export async function deleteZone(zoneId) {
  const zoneRef = ref(db, `${ZONES_PATH}/${zoneId}`);
  await remove(zoneRef);
}

/**
 * Fetch all zones once (no real-time updates).
 */
export function fetchZonesOnce() {
  return new Promise((resolve, reject) => {
    const zonesRef = ref(db, ZONES_PATH);
    onValue(zonesRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        resolve([]);
        return;
      }
      const zones = Object.entries(data).map(([id, zone]) => ({
        id,
        ...zone
      }));
      resolve(zones);
    }, reject, { onlyOnce: true });
  });
}
