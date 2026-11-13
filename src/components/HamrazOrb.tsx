import React from 'react';
import './HamrazOrb.css';

export type HamrazOrbState = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy';

export interface HamrazOrbProps {
  state?: HamrazOrbState;
  /** Pixel size of the orb (width/height). All inner features scale from it. */
  size?: number;
  /** Optional primary CSS color. Sets --hamraz-orb-color and derives --hamraz-orb-color-2. */
  color?: string;
  className?: string;
  /** Accessible label. */
  title?: string;
  /** Extra inline styles; useful for setting --hamraz-orb-color / --hamraz-orb-color-2 directly. */
  style?: React.CSSProperties;
}

type HamrazOrbStyle = React.CSSProperties & {
  '--hamraz-orb-color'?: string;
  '--hamraz-orb-color-2'?: string;
};

/**
 * Ham-Raz (هم‌راز) assistant orb — a self-contained, dependency-free CSS avatar.
 * Organic wobbly blob, glowing eyes, and state-driven motion (no WebGL / no libs).
 *
 * RECOLORING
 *   a) CSS custom properties (they inherit, so they can be set on the orb root or any ancestor):
 *        --hamraz-orb-color   base / core color   (default #10b981 emerald)
 *        --hamraz-orb-color-2 bright highlight     (default #2dd4bf teal)
 *      e.g. <HamrazOrb style={{ '--hamraz-orb-color': '#8b5cf6' }} />  (plus color-2)
 *   b) Or pass the `color` prop with any CSS color; the second gradient stop is derived
 *      automatically as color-mix(in srgb, <color> 76%, #ffffff).
 *
 * Honors prefers-reduced-motion: no looping animation, still a static organic orb.
 */
export function HamrazOrb({
  state = 'idle',
  size = 40,
  color,
  className,
  title = 'هم‌راز',
  style,
}: HamrazOrbProps) {
  const cssVars: HamrazOrbStyle = {
    ...style,
    width: size,
    height: size,
    fontSize: size,
    ...(color
      ? {
          '--hamraz-orb-color': color,
          '--hamraz-orb-color-2': `color-mix(in srgb, ${color} 76%, #ffffff)`,
        }
      : {}),
  };

  return (
    <span
      className={className ? `hamraz-orb ${className}` : 'hamraz-orb'}
      data-state={state}
      role="img"
      aria-label={title}
      style={cssVars}
    >
      <span className="hamraz-orb__aura" aria-hidden="true" />
      <span className="hamraz-orb__ripple" aria-hidden="true" />
      <span className="hamraz-orb__body" aria-hidden="true">
        <span className="hamraz-orb__highlight" />
        <span className="hamraz-orb__eyes">
          <span className="hamraz-orb__eye" />
          <span className="hamraz-orb__eye" />
        </span>
        <span className="hamraz-orb__mouth">
          <span />
          <span />
          <span />
          <span />
        </span>
      </span>
    </span>
  );
}

export default HamrazOrb;
