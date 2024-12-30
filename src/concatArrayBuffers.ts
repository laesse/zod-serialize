type ConcatArrayBuffers = (
  buffers: Array<ArrayBufferView | ArrayBufferLike>,
) => ArrayBuffer;
export const { concatArrayBuffers } = ((): {
  concatArrayBuffers: ConcatArrayBuffers;
} => {
  if (globalThis.Bun !== undefined) {
    return globalThis.Bun;
  }
  const concatArrayBuffers: ConcatArrayBuffers = (buffers) => {
    const totalLength = buffers.reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0,
    );

    const combinedBuffer = new ArrayBuffer(totalLength);
    const combinedView = new Uint8Array(combinedBuffer);
    let offset = 0;
    buffers.forEach((buffer) => {
      if (ArrayBuffer.isView(buffer)) {
        combinedView.set(
          new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          offset,
        );
        offset += buffer.byteLength;
      } else if (buffer instanceof ArrayBuffer) {
        combinedView.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }
    });

    return combinedBuffer;
  };
  return { concatArrayBuffers };
})();
