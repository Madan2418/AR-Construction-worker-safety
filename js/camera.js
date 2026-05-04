// camera.js — Camera setup module for AR Safety Visualizer

/**
 * Start the rear camera and stream it to a video element
 * Falls back to front camera if environment-facing is unavailable
 */
export async function startCamera(videoElement) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // rear camera preferred
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    videoElement.srcObject = stream;
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve();
      };
    });
    return stream;
  } catch (err) {
    // Fallback: try any available camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoElement.srcObject = stream;
      await new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play();
          resolve();
        };
      });
      return stream;
    } catch (fallbackErr) {
      throw new Error('Camera access denied or unavailable: ' + fallbackErr.message);
    }
  }
}

/**
 * Stop all camera tracks cleanly
 */
export function stopCamera(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * Resize a canvas to match a video element's display size
 */
export function resizeCanvasToVideo(canvas, video) {
  canvas.width = video.clientWidth;
  canvas.height = video.clientHeight;
}
