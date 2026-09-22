import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from './components/lib/utils';

export function ResizeHandle({ label, orientation, value, min, max, onChange, onDragChange, reverse = false, className }: {
  label: string; orientation: 'vertical' | 'horizontal'; value: number; min: number; max: number;
  onChange: (value: number) => void; onDragChange?: (dragging: boolean) => void; reverse?: boolean; className?: string;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const clamp = (next: number) => Math.round(Math.max(min, Math.min(Math.max(min, max), next)));
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanup.current?.();
    const element = event.currentTarget;
    const initial = orientation === 'vertical' ? event.clientX : event.clientY;
    const sign = reverse ? -1 : 1;
    element.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('desk-resizing');
    element.dataset.dragging = 'true';
    onDragChange?.(true);
    const move = (next: PointerEvent) => onChange(clamp(value + sign * ((orientation === 'vertical' ? next.clientX : next.clientY) - initial)));
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      delete element.dataset.dragging;
      document.documentElement.classList.remove('desk-resizing');
      cleanup.current = null;
      onDragChange?.(false);
    };
    cleanup.current = end;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
  }
  return <div role="separator" aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={Math.max(min, Math.round(max))} aria-valuenow={Math.round(value)} tabIndex={0}
    className={cn('resize-handle', `resize-${orientation}`, className)} onPointerDown={start} onKeyDown={event => {
      const negative = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const positive = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === negative || event.key === positive) { event.preventDefault(); onChange(clamp(value + (event.key === negative ? -1 : 1) * (reverse ? -1 : 1) * (event.shiftKey ? 48 : 16))); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); onChange(event.key === 'Home' ? min : Math.max(min, max)); }
    }} />;
}
