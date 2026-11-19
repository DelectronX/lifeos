/**
 * <ascii-art> — the ASCII Magic web component (MIT), self-hosted under
 * /public/ascii and registered by /ascii/ascii.js, which index.html loads
 * once. Decoration only: always pair it with real text.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type AsciiArtAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  piece: string;
  look?: 'dots' | 'ascii' | 'dense' | 'numbers' | 'binary' | 'letters' | 'blocks' | 'squares' | 'lines' | 'dither';
  size?: number | string;
  speed?: number | string;
  /** Frame-rate cap (LifeOS local change, see public/ascii/LOCAL_CHANGES.md). */
  fps?: number | string;
  still?: boolean | '';
  mono?: boolean | '';
  contrast?: number | string;
  density?: number | string;
  bg?: string;
};

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ascii-art': AsciiArtAttributes;
    }
  }
}
