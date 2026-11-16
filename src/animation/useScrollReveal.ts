import { useEffect, useRef } from 'react';

const REVEAL_SELECTOR = '[data-reveal]';
const MAX_STAGGER = 5;

/**
 * Reveals the `[data-reveal]` descendants of the returned ref as they scroll into view.
 * Each one gets `data-revealed` once, and `--reveal-index` (its position among revealed siblings) to stagger groups.
 */
export function useScrollReveal<T extends HTMLElement>() {
  const container = useRef<T>(null);
  useEffect(() => {
    const items = Array.from(container.current?.querySelectorAll<HTMLElement>(REVEAL_SELECTOR) ?? []);
    const reveal = (item: HTMLElement) => item.setAttribute('data-revealed', '');
    if (typeof IntersectionObserver === 'undefined') { items.forEach(reveal); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reveal(entry.target as HTMLElement);
      observer.unobserve(entry.target);
    }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    items.forEach(item => {
      const siblings = Array.from(item.parentElement?.children ?? []).filter(child => child.matches(REVEAL_SELECTOR));
      item.style.setProperty('--reveal-index', String(Math.min(siblings.indexOf(item), MAX_STAGGER)));
      observer.observe(item);
    });
    return () => observer.disconnect();
  }, []);
  return container;
}
