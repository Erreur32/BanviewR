// Tint and ink pairs that read on the dark background; the name picks one, so a user keeps their colour
const TINTS = [
  ['#388bfd33', '#79c0ff'],
  ['#2ea04333', '#7ee787'],
  ['#a371f733', '#d2a8ff'],
  ['#db6d2833', '#ffa657'],
  ['#db61a233', '#ff9bce'],
  ['#1b7c8333', '#76e3ea'],
  ['#bb800933', '#e3b341'],
  ['#f8514933', '#ffa198'],
] as const;

export function initials(username: string) {
  const parts = username.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : username.slice(0, 2);
  return letters.toUpperCase();
}

export function tintOf(username: string) {
  let hash = 0;
  for (const ch of username.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0];
}

// Centre square of the picture, scaled down and encoded again: a small upload, and the
// browser drops the metadata (camera, GPS) on the way
export async function squarePicture(file: Blob, size = 256) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext('2d')
    ?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  // Browsers without a WebP encoder give PNG, the server takes both
  const url = canvas.toDataURL('image/webp', 0.85);
  return url.slice(url.indexOf(',') + 1);
}
