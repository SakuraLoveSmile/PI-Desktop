/** Wait for a nonempty frame at the requested size after one invalidation. */
export function captureFrameAfterRepaint(contents, { width, height }, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2 ** 31 - 1) {
      reject(new RangeError("Capture frame timeout must be a finite timer duration"));
      return;
    }
    let settled = false;
    let requested = false;
    let invalidating = false;
    let pendingFrame;
    let timer;
    const finish = (error, frame) => {
      if (settled) return;
      settled = true;
      contents.removeListener("paint", onPaint);
      contents.removeListener("destroyed", onDestroyed);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(frame);
    };
    const onDestroyed = () => finish(new Error("Web contents destroyed while waiting for capture frame"));
    const onPaint = (_event, dirtyRect, image) => {
      if (!requested || settled) return;
      try {
        if (image.isEmpty()) return;
        const size = image.getSize();
        if (size.width !== width || size.height !== height) return;
        const frame = { size, dirtyRect, empty: false };
        if (invalidating) pendingFrame ??= frame;
        else finish(null, frame);
      } catch (error) {
        finish(error);
      }
    };
    contents.on("paint", onPaint);
    contents.on("destroyed", onDestroyed);
    timer = setTimeout(() => finish(new Error(
      `Timed out after ${timeoutMs}ms waiting for capture frame ${width}x${height}`,
    )), timeoutMs);
    try {
      if (contents.isDestroyed()) {
        onDestroyed();
        return;
      }
      requested = true;
      invalidating = true;
      contents.invalidate();
      invalidating = false;
      if (pendingFrame) finish(null, pendingFrame);
    } catch (error) {
      invalidating = false;
      finish(error);
    }
  });
}
