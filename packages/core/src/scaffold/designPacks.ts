/**
 * Design Pack System (Step 35.5)
 * 
 * Curated design packs for greenfield scaffolds with deterministic selection.
 * Makes scaffolded projects visually distinct without randomness or LLM calls.
 * 
 * Each pack defines:
 * - Color tokens (CSS variable-ready)
 * - Typography (font families)
 * - Spacing/radius/shadow preferences
 * - Preview metadata for UI display
 */

// ============================================================================
// DESIGN PACK TYPES
// ============================================================================

export type DesignPackId = string;

export type DesignVibe = 
  | 'minimal' 
  | 'enterprise' 
  | 'vibrant' 
  | 'warm' 
  | 'neo' 
  | 'glass' 
  | 'gradient' 
  | 'dark';

export type RadiusSize = 'sm' | 'md' | 'lg';
export type DensityLevel = 'compact' | 'default' | 'relaxed';
export type ShadowLevel = 'none' | 'subtle' | 'medium' | 'dramatic';

/**
 * Color tokens for a design pack
 * These map directly to CSS variables
 */
export interface ColorTokens {
  primary: string;           // Main brand color
  secondary: string;         // Secondary/accent
  accent: string;            // Highlight/CTA
  background: string;        // Page background
  foreground: string;        // Primary text
  muted: string;             // Muted backgrounds
  border: string;            // Border color
  // Derived colors (computed from above)
  primary_foreground?: string;  // Text on primary
  secondary_foreground?: string;
  accent_foreground?: string;
  muted_foreground?: string;
}

/**
 * Typography tokens
 */
export interface FontTokens {
  heading: string;  // Font family for headings (e.g., "Inter", "Cal Sans")
  body: string;     // Font family for body text
}

/**
 * Complete token set for a design pack
 */
export interface DesignPackTokens {
  colors: ColorTokens;
  fonts: FontTokens;
  radius: RadiusSize;
  density: DensityLevel;
  shadow: ShadowLevel;
}

/**
 * Preview metadata for UI display
 */
export interface DesignPackPreview {
  /** Stable asset ID that maps to bundled preview image */
  imageAssetId: string;
  /** Short description (max 1 line) */
  description: string;
}

/**
 * Complete Design Pack definition
 */
export interface DesignPack {
  /** Unique identifier (e.g., "minimal-light") */
  id: DesignPackId;
  /** Human-readable name (e.g., "Minimal Light") */
  name: string;
  /** Visual vibe category */
  vibe: DesignVibe;
  /** Design tokens */
  tokens: DesignPackTokens;
  /** Preview metadata */
  preview: DesignPackPreview;
}

// ============================================================================
// CURATED DESIGN PACKS (12 packs)
// ============================================================================

export const DESIGN_PACKS: DesignPack[] = [
  // =========== MINIMAL ===========
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    vibe: 'minimal',
    tokens: {
      colors: {
        primary: '#0f172a',
        secondary: '#64748b',
        accent: '#0ea5e9',
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#f1f5f9',
        border: '#e2e8f0',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#64748b',
      },
      fonts: {
        heading: 'Inter',
        body: 'Inter',
      },
      radius: 'md',
      density: 'default',
      shadow: 'subtle',
    },
    preview: {
      imageAssetId: 'minimal-light',
      description: 'Clean, modern design with plenty of whitespace',
    },
  },
  {
    id: 'minimal-dark',
    name: 'Minimal Dark',
    vibe: 'minimal',
    tokens: {
      colors: {
        primary: '#f8fafc',
        secondary: '#94a3b8',
        accent: '#38bdf8',
        background: '#0f172a',
        foreground: '#f8fafc',
        muted: '#1e293b',
        border: '#334155',
        primary_foreground: '#0f172a',
        secondary_foreground: '#0f172a',
        accent_foreground: '#0f172a',
        muted_foreground: '#94a3b8',
      },
      fonts: {
        heading: 'Inter',
        body: 'Inter',
      },
      radius: 'md',
      density: 'default',
      shadow: 'subtle',
    },
    preview: {
      imageAssetId: 'minimal-dark',
      description: 'Sleek dark theme with cool accents',
    },
  },

  // =========== ENTERPRISE ===========
  {
    id: 'enterprise-blue',
    name: 'Enterprise Blue',
    vibe: 'enterprise',
    tokens: {
      colors: {
        primary: '#1e40af',
        secondary: '#3b82f6',
        accent: '#0284c7',
        background: '#ffffff',
        foreground: '#1e293b',
        muted: '#f8fafc',
        border: '#e2e8f0',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#64748b',
      },
      fonts: {
        heading: 'IBM Plex Sans',
        body: 'IBM Plex Sans',
      },
      radius: 'sm',
      density: 'compact',
      shadow: 'medium',
    },
    preview: {
      imageAssetId: 'enterprise-blue',
      description: 'Professional blue theme for business apps',
    },
  },
  {
    id: 'enterprise-slate',
    name: 'Enterprise Slate',
    vibe: 'enterprise',
    tokens: {
      colors: {
        primary: '#334155',
        secondary: '#64748b',
        accent: '#0d9488',
        background: '#ffffff',
        foreground: '#1e293b',
        muted: '#f8fafc',
        border: '#cbd5e1',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#64748b',
      },
      fonts: {
        heading: 'IBM Plex Sans',
        body: 'IBM Plex Sans',
      },
      radius: 'sm',
      density: 'compact',
      shadow: 'medium',
    },
    preview: {
      imageAssetId: 'enterprise-slate',
      description: 'Sophisticated slate with teal accents',
    },
  },

  // =========== VIBRANT ===========
  {
    id: 'vibrant-pop',
    name: 'Vibrant Pop',
    vibe: 'vibrant',
    tokens: {
      colors: {
        primary: '#7c3aed',
        secondary: '#ec4899',
        accent: '#f59e0b',
        background: '#fefce8',
        foreground: '#1c1917',
        muted: '#fef3c7',
        border: '#fde047',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#1c1917',
        muted_foreground: '#78716c',
      },
      fonts: {
        heading: 'Poppins',
        body: 'Poppins',
      },
      radius: 'lg',
      density: 'relaxed',
      shadow: 'dramatic',
    },
    preview: {
      imageAssetId: 'vibrant-pop',
      description: 'Playful and colorful with bold accents',
    },
  },
  {
    id: 'vibrant-neon',
    name: 'Vibrant Neon',
    vibe: 'vibrant',
    tokens: {
      colors: {
        primary: '#a855f7',
        secondary: '#22d3ee',
        accent: '#f472b6',
        background: '#18181b',
        foreground: '#fafafa',
        muted: '#27272a',
        border: '#3f3f46',
        primary_foreground: '#000000',
        secondary_foreground: '#000000',
        accent_foreground: '#000000',
        muted_foreground: '#a1a1aa',
      },
      fonts: {
        heading: 'Space Grotesk',
        body: 'Space Grotesk',
      },
      radius: 'md',
      density: 'default',
      shadow: 'dramatic',
    },
    preview: {
      imageAssetId: 'vibrant-neon',
      description: 'Dark theme with electric neon colors',
    },
  },

  // =========== WARM ===========
  {
    id: 'warm-sand',
    name: 'Warm Sand',
    vibe: 'warm',
    tokens: {
      colors: {
        primary: '#92400e',
        secondary: '#b45309',
        accent: '#dc2626',
        background: '#fffbeb',
        foreground: '#451a03',
        muted: '#fef3c7',
        border: '#fde68a',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#a16207',
      },
      fonts: {
        heading: 'Playfair Display',
        body: 'Source Sans Pro',
      },
      radius: 'md',
      density: 'relaxed',
      shadow: 'subtle',
    },
    preview: {
      imageAssetId: 'warm-sand',
      description: 'Earthy tones with warm amber highlights',
    },
  },
  {
    id: 'warm-olive',
    name: 'Warm Olive',
    vibe: 'warm',
    tokens: {
      colors: {
        primary: '#3f6212',
        secondary: '#65a30d',
        accent: '#ca8a04',
        background: '#fefce8',
        foreground: '#1a2e05',
        muted: '#ecfccb',
        border: '#bef264',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#000000',
        muted_foreground: '#4d7c0f',
      },
      fonts: {
        heading: 'Merriweather',
        body: 'Source Sans Pro',
      },
      radius: 'md',
      density: 'relaxed',
      shadow: 'subtle',
    },
    preview: {
      imageAssetId: 'warm-olive',
      description: 'Natural green palette with golden accents',
    },
  },

  // =========== NEO / BRUTALIST ===========
  {
    id: 'neo-brutalist',
    name: 'Neo Brutalist',
    vibe: 'neo',
    tokens: {
      colors: {
        primary: '#000000',
        secondary: '#000000',
        accent: '#facc15',
        background: '#ffffff',
        foreground: '#000000',
        muted: '#f5f5f5',
        border: '#000000',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#000000',
        muted_foreground: '#525252',
      },
      fonts: {
        heading: 'DM Sans',
        body: 'DM Sans',
      },
      radius: 'sm',
      density: 'default',
      shadow: 'dramatic',
    },
    preview: {
      imageAssetId: 'neo-brutalist',
      description: 'Bold black borders with punchy yellow accents',
    },
  },

  // =========== GLASS ===========
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    vibe: 'glass',
    tokens: {
      colors: {
        primary: 'rgba(99, 102, 241, 0.9)',
        secondary: 'rgba(139, 92, 246, 0.8)',
        accent: 'rgba(236, 72, 153, 0.9)',
        background: '#f8fafc',
        foreground: '#1e293b',
        muted: 'rgba(255, 255, 255, 0.4)',
        border: 'rgba(255, 255, 255, 0.3)',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#64748b',
      },
      fonts: {
        heading: 'Inter',
        body: 'Inter',
      },
      radius: 'lg',
      density: 'relaxed',
      shadow: 'medium',
    },
    preview: {
      imageAssetId: 'glassmorphism',
      description: 'Frosted glass effects with soft gradients',
    },
  },

  // =========== GRADIENT ===========
  {
    id: 'gradient-sunset',
    name: 'Gradient Sunset',
    vibe: 'gradient',
    tokens: {
      colors: {
        primary: '#f97316',
        secondary: '#ec4899',
        accent: '#a855f7',
        background: '#fffbeb',
        foreground: '#1c1917',
        muted: '#fff7ed',
        border: '#fed7aa',
        primary_foreground: '#ffffff',
        secondary_foreground: '#ffffff',
        accent_foreground: '#ffffff',
        muted_foreground: '#78716c',
      },
      fonts: {
        heading: 'Montserrat',
        body: 'Inter',
      },
      radius: 'lg',
      density: 'default',
      shadow: 'medium',
    },
    preview: {
      imageAssetId: 'gradient-sunset',
      description: 'Warm orange to pink gradients',
    },
  },
  {
    id: 'gradient-ocean',
    name: 'Gradient Ocean',
    vibe: 'gradient',
    tokens: {
      colors: {
        primary: '#0284c7',
        secondary: '#06b6d4',
        accent: '#8b5cf6',
        background: '#f0f9ff',
        foreground: '#0c4a6e',
        muted: '#e0f2fe',
        border: '#bae6fd',
        primary_foreground: '#ffffff',
        secondary_foreground: '#000000',
        accent_foreground: '#ffffff',
        muted_foreground: '#0369a1',
      },
      fonts: {
        heading: 'Montserrat',
        body: 'Inter',
      },
      radius: 'lg',
      density: 'default',
      shadow: 'medium',
    },
    preview: {
      imageAssetId: 'gradient-ocean',
      description: 'Cool blue to cyan ocean tones',
    },
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a design pack by ID
 * @param id - Design pack ID
 * @returns DesignPack or undefined
 */
export function getDesignPackById(id: DesignPackId): DesignPack | undefined {
  return DESIGN_PACKS.find(pack => pack.id === id);
}

/**
 * Get default packs for the quick style picker (max 6, diverse vibes)
 * @returns Array of up to 6 design packs representing different vibes
 */
export function getDefaultPacksForPicker(): DesignPack[] {
  // Return one pack from each major vibe category for diversity
  const pickerPacks: DesignPack[] = [];
  const seenVibes = new Set<DesignVibe>();
  
  // Priority order for picker diversity
  const priorityIds = [
    'minimal-light',      // Clean default
    'minimal-dark',       // Dark option
    'enterprise-blue',    // Professional
    'vibrant-neon',       // Fun/modern
    'gradient-ocean',     // Colorful
    'neo-brutalist',      // Bold/unique
  ];
  
  for (const id of priorityIds) {
    const pack = getDesignPackById(id);
    if (pack && pickerPacks.length < 6) {
      pickerPacks.push(pack);
    }
  }
  
  return pickerPacks;
}

/**
 * Get all packs for a specific vibe
 * @param vibe - Vibe to filter by
 * @returns Array of design packs matching the vibe
 */
export function getPacksByVibe(vibe: DesignVibe): DesignPack[] {
  return DESIGN_PACKS.filter(pack => pack.vibe === vibe);
}

/**
 * Get enterprise-appropriate packs (for business/B2B/admin apps)
 * @returns Array of enterprise-suitable design packs
 */
export function getEnterpriseSubset(): DesignPack[] {
  return DESIGN_PACKS.filter(pack => 
    pack.vibe === 'enterprise' || 
    pack.vibe === 'minimal' ||
    (pack.vibe === 'dark' && pack.tokens.shadow === 'subtle')
  );
}

/**
 * Get mobile-friendly packs (for mobile/expo apps)
 * @returns Array of mobile-suitable design packs
 */
export function getMobileSubset(): DesignPack[] {
  return DESIGN_PACKS.filter(pack =>
    pack.vibe === 'vibrant' ||
    pack.vibe === 'warm' ||
    pack.vibe === 'minimal' ||
    pack.vibe === 'gradient'
  );
}

/**
 * Format tokens summary for display
 * @param pack - Design pack
 * @returns Short summary string
 */
export function formatTokensSummary(pack: DesignPack): string {
  const { colors, fonts } = pack.tokens;
  return `Primary: ${colors.primary} | Font: ${fonts.heading}`;
}

/**
 * Get the asset path for a design pack preview image
 * @param imageAssetId - Asset ID from preview
 * @returns Path to the preview image asset
 */
export function getPreviewAssetPath(imageAssetId: string): string {
  // V1: Static assets bundled with extension
  return `assets/designpacks/${imageAssetId}.png`;
}

/**
 * Validate a design pack ID
 * @param id - ID to validate
 * @returns true if valid
 */
export function isValidDesignPackId(id: string): id is DesignPackId {
  return DESIGN_PACKS.some(pack => pack.id === id);
}

// ============================================================================
// CSS VARIABLE GENERATION
// ============================================================================

/**
 * Generate CSS variables from design tokens
 * @param tokens - Design tokens
 * @returns CSS variable declarations string
 */
export function generateCssVariables(tokens: DesignPackTokens): string {
  const { colors, fonts, radius, density, shadow } = tokens;
  
  const radiusMap: Record<RadiusSize, string> = {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '1rem',
  };
  
  const densityMap: Record<DensityLevel, { base: string; lg: string }> = {
    compact: { base: '0.5rem', lg: '0.75rem' },
    default: { base: '1rem', lg: '1.5rem' },
    relaxed: { base: '1.5rem', lg: '2rem' },
  };
  
  const shadowMap: Record<ShadowLevel, string> = {
    none: 'none',
    subtle: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    medium: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    dramatic: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  };

  return `
  /* Design Pack Tokens - Generated by Ordinex */
  --background: ${colors.background};
  --foreground: ${colors.foreground};
  --primary: ${colors.primary};
  --primary-foreground: ${colors.primary_foreground || '#ffffff'};
  --secondary: ${colors.secondary};
  --secondary-foreground: ${colors.secondary_foreground || '#ffffff'};
  --accent: ${colors.accent};
  --accent-foreground: ${colors.accent_foreground || '#ffffff'};
  --muted: ${colors.muted};
  --muted-foreground: ${colors.muted_foreground || colors.secondary};
  --border: ${colors.border};
  
  /* Typography */
  --font-heading: "${fonts.heading}", system-ui, sans-serif;
  --font-body: "${fonts.body}", system-ui, sans-serif;
  
  /* Spacing & Radius */
  --radius: ${radiusMap[radius]};
  --radius-sm: calc(var(--radius) * 0.5);
  --radius-lg: calc(var(--radius) * 1.5);
  
  /* Density */
  --spacing-base: ${densityMap[density].base};
  --spacing-lg: ${densityMap[density].lg};
  
  /* Shadow */
  --shadow: ${shadowMap[shadow]};
`.trim();
}

/**
 * Generate a tailwind.config.ts that extends the Tailwind theme with design pack tokens.
 * Maps CSS variables to Tailwind theme keys so classes like `bg-primary`, `text-accent-foreground`,
 * `border-border`, `font-heading` all work as first-class Tailwind classes.
 *
 * @param pack - Design pack to use
 * @returns Complete tailwind.config.ts file content
 */
export function generateTailwindConfig(pack: DesignPack): string {
  const { radius, shadow } = pack.tokens;

  const radiusMap: Record<RadiusSize, string> = {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '1rem',
  };

  const shadowMap: Record<ShadowLevel, string> = {
    none: 'none',
    subtle: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    medium: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    dramatic: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  };

  return `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        border: "var(--border)",
      },
      borderRadius: {
        DEFAULT: "${radiusMap[radius]}",
        sm: "${parseFloat(radiusMap[radius]) * 0.5}rem",
        lg: "${parseFloat(radiusMap[radius]) * 1.5}rem",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
      },
      boxShadow: {
        DEFAULT: "${shadowMap[shadow]}",
      },
    },
  },
  plugins: [],
};

export default config;
`;
}

/**
 * Generate a complete globals.css content with design tokens
 * @param pack - Design pack to use
 * @returns Complete CSS file content
 */
export function generateGlobalsCss(pack: DesignPack): string {
  const cssVars = generateCssVariables(pack.tokens);
  
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    ${cssVars.split('\n').map(line => '    ' + line.trim()).join('\n')}
  }

  .dark {
    /* Dark mode overrides - customize per pack if needed */
  }
}

@layer base {
  * {
    border-color: var(--border);
  }
  body {
    background-color: var(--background);
    color: var(--foreground);
    font-family: var(--font-body);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading);
  }
}
`;
}
