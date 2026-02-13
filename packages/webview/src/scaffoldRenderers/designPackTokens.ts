// Design pack token definitions for visual preview rendering.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

declare function escapeHtml(text: string): string;

function getDesignPackTokens(packId: string, styleOverrides?: any): any {
  const PACK_TOKENS: Record<string, any> = {
    'minimal-light': {
      colors: { primary: '#0f172a', secondary: '#64748b', accent: '#0ea5e9', background: '#ffffff', foreground: '#0f172a', muted: '#f1f5f9', border: '#e2e8f0', primary_fg: '#ffffff' },
      fonts: { heading: 'Inter', body: 'Inter' },
      radius: '8px'
    },
    'minimal-dark': {
      colors: { primary: '#f8fafc', secondary: '#94a3b8', accent: '#38bdf8', background: '#0f172a', foreground: '#f8fafc', muted: '#1e293b', border: '#334155', primary_fg: '#0f172a' },
      fonts: { heading: 'Inter', body: 'Inter' },
      radius: '8px'
    },
    'enterprise-blue': {
      colors: { primary: '#1e40af', secondary: '#3b82f6', accent: '#0284c7', background: '#ffffff', foreground: '#1e293b', muted: '#f8fafc', border: '#e2e8f0', primary_fg: '#ffffff' },
      fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
      radius: '4px'
    },
    'vibrant-neon': {
      colors: { primary: '#a855f7', secondary: '#22d3ee', accent: '#f472b6', background: '#18181b', foreground: '#fafafa', muted: '#27272a', border: '#3f3f46', primary_fg: '#000000' },
      fonts: { heading: 'Space Grotesk', body: 'Space Grotesk' },
      radius: '8px'
    },
    'gradient-ocean': {
      colors: { primary: '#0284c7', secondary: '#06b6d4', accent: '#8b5cf6', background: '#f0f9ff', foreground: '#0c4a6e', muted: '#e0f2fe', border: '#bae6fd', primary_fg: '#ffffff' },
      fonts: { heading: 'Montserrat', body: 'Inter' },
      radius: '12px'
    },
    'neo-brutalist': {
      colors: { primary: '#000000', secondary: '#000000', accent: '#facc15', background: '#ffffff', foreground: '#000000', muted: '#f5f5f5', border: '#000000', primary_fg: '#ffffff' },
      fonts: { heading: 'DM Sans', body: 'DM Sans' },
      radius: '4px'
    },
    'vibrant-pop': {
      colors: { primary: '#7c3aed', secondary: '#ec4899', accent: '#f59e0b', background: '#fefce8', foreground: '#1c1917', muted: '#fef3c7', border: '#fde047', primary_fg: '#ffffff' },
      fonts: { heading: 'Poppins', body: 'Poppins' },
      radius: '12px'
    },
    'warm-sand': {
      colors: { primary: '#92400e', secondary: '#b45309', accent: '#dc2626', background: '#fffbeb', foreground: '#451a03', muted: '#fef3c7', border: '#fde68a', primary_fg: '#ffffff' },
      fonts: { heading: 'Playfair Display', body: 'Source Sans Pro' },
      radius: '8px'
    },
    'enterprise-slate': {
      colors: { primary: '#334155', secondary: '#64748b', accent: '#0d9488', background: '#ffffff', foreground: '#1e293b', muted: '#f8fafc', border: '#cbd5e1', primary_fg: '#ffffff' },
      fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
      radius: '4px'
    },
    'gradient-sunset': {
      colors: { primary: '#f97316', secondary: '#ec4899', accent: '#a855f7', background: '#fffbeb', foreground: '#1c1917', muted: '#fff7ed', border: '#fed7aa', primary_fg: '#ffffff' },
      fonts: { heading: 'Montserrat', body: 'Inter' },
      radius: '12px'
    },
    'glassmorphism': {
      colors: { primary: '#6366f1', secondary: '#8b5cf6', accent: '#ec4899', background: '#f8fafc', foreground: '#1e293b', muted: 'rgba(255,255,255,0.4)', border: 'rgba(255,255,255,0.3)', primary_fg: '#ffffff' },
      fonts: { heading: 'Inter', body: 'Inter' },
      radius: '12px'
    },
    'warm-olive': {
      colors: { primary: '#3f6212', secondary: '#65a30d', accent: '#ca8a04', background: '#fefce8', foreground: '#1a2e05', muted: '#ecfccb', border: '#bef264', primary_fg: '#ffffff' },
      fonts: { heading: 'Merriweather', body: 'Source Sans Pro' },
      radius: '8px'
    }
  };

  let tokens = PACK_TOKENS[packId] || PACK_TOKENS['minimal-light'];

  if (styleOverrides?.palette) {
    tokens = { ...tokens, colors: { ...tokens.colors } };
    if (styleOverrides.palette.primary) tokens.colors.primary = styleOverrides.palette.primary;
    if (styleOverrides.palette.secondary) tokens.colors.secondary = styleOverrides.palette.secondary;
    if (styleOverrides.palette.accent) tokens.colors.accent = styleOverrides.palette.accent;
  }
  if (styleOverrides?.radius) {
    const radiusMap: Record<string, string> = { 'none': '0px', 'sm': '4px', 'md': '8px', 'lg': '12px', 'full': '9999px' };
    tokens.radius = radiusMap[styleOverrides.radius] || tokens.radius;
  }

  return tokens;
}
