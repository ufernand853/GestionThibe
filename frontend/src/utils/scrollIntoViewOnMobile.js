export default function scrollIntoViewOnMobile(target) {
  if (!window.matchMedia('screen and (max-width: 900px)').matches) return;
  window.requestAnimationFrame(() => {
    const element = typeof target === 'function' ? target() : target;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
}
