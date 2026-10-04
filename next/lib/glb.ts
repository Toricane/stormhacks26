export async function validateGlb(file: Blob) {
  const header = await file.slice(0, 20).arrayBuffer();
  if (header.byteLength < 20) throw new Error("Choose a valid GLB file.");
  const view = new DataView(header);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("Choose a GLB version 2 file.");
  }
  if (view.getUint32(8, true) !== file.size) throw new Error("The GLB file is incomplete or has an invalid header.");
}
