declare module 'culori' {
  interface Color {
    mode: string;
    [key: string]: unknown;
  }

  interface OklchColor extends Color {
    mode: 'oklch';
    l: number;
    c: number;
    h: number;
    alpha?: number;
  }

  interface RgbColor extends Color {
    mode: 'rgb';
    r: number;
    g: number;
    b: number;
    alpha?: number;
  }

  export function parse(input: string): Color | undefined;
  export function oklch(color: Color): OklchColor;
  export function rgb(color: Color): RgbColor;
  export function formatHex(color: Color): string;
  export function clampChroma(color: Color, mode: string): Color;
}
