const cache = new Map<string, HTMLAudioElement>();

function get(name: string): HTMLAudioElement {
  if (!cache.has(name)) {
    cache.set(name, new Audio(`/sfx/${name}`));
  }
  return cache.get(name)!;
}

export function playSfx(name: string, volume = 0.7): void {
  try {
    const el = get(name);
    el.currentTime = 0;
    el.volume = volume;
    el.play().catch(() => {});
  } catch { /* ignore */ }
}
