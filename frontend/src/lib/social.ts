/** Set at build time after the owner supplies their exact profile URL. */
export function pandaXProfile(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) ||
      url.username || url.password || !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname) || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}
export const PANDA_X_PROFILE = pandaXProfile(import.meta.env.VITE_PANDA_X_URL ?? 'https://x.com/PandaCoderexe');
