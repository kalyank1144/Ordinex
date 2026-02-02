/**
 * Expo (React Native) Recipe (Step 35.3)
 *
 * Minimal runnable Expo project for iOS/Android.
 * TypeScript by default, ~8-12 files.
 */

import { RecipeBuilder, RecipeContext, RecipePlan, FilePlanItem, CommandPlanItem } from '../recipeTypes';
import { getInstallCommand, getRunCommand } from '../recipeSelector';
import { DesignPack, DESIGN_PACKS } from '../designPacks';

const packageJson = (appName: string) => `{
  "name": "${appName}",
  "version": "1.0.0",
  "main": "expo/AppEntry.js",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~50.0.0",
    "expo-status-bar": "~1.11.0",
    "react": "18.2.0",
    "react-native": "0.73.0"
  },
  "devDependencies": {
    "@babel/core": "^7.20.0",
    "@types/react": "~18.2.0",
    "typescript": "^5.1.0"
  },
  "private": true
}
`;

/**
 * Generate app.json with design pack colors for splash/icons
 * Note: We include SVG placeholder paths that work for development.
 * For production, users should convert SVGs to PNGs or use proper assets.
 */
const getAppJson = (appName: string, pack?: DesignPack): string => {
  const backgroundColor = pack?.tokens.colors.background || '#ffffff';

  return `{
  "expo": {
    "name": "${appName}",
    "slug": "${appName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.svg",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash.svg",
      "resizeMode": "contain",
      "backgroundColor": "${backgroundColor}"
    },
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.svg",
        "backgroundColor": "${backgroundColor}"
      }
    },
    "web": {
      "favicon": "./assets/favicon.svg"
    }
  }
}
`;
};

const tsconfig = `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}
`;

/**
 * Generate App.tsx with design pack colors for React Native
 */
const getAppTsx = (appName: string, pack?: DesignPack): string => {
  const colors = pack?.tokens.colors;
  const backgroundColor = colors?.background || '#fff';
  const foreground = colors?.foreground || '#000';
  const mutedForeground = colors?.muted_foreground || '#666';
  const accent = colors?.accent || '#0ea5e9';

  return `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Pressable } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>${appName}</Text>
      <Text style={styles.subtitle}>Welcome to your Expo app!</Text>
      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Get Started</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

// Design tokens from Ordinex Design Pack${pack ? `: ${pack.name}` : ''}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '${backgroundColor}',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '${foreground}',
  },
  subtitle: {
    fontSize: 16,
    color: '${mutedForeground}',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '${accent}',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '${colors?.accent_foreground || '#fff'}',
    fontSize: 16,
    fontWeight: '600',
  },
});
`;
};

const gitignore = `node_modules/
.expo/
dist/
npm-debug.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.orig.*
web-build/
.DS_Store
*.pem
`;

const readme = (appName: string, pm: string) => `# ${appName}

A React Native app built with [Expo](https://expo.dev/).

## Getting Started

Install dependencies:
\`\`\`bash
${pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn' : 'pnpm install'}
\`\`\`

Start the development server:
\`\`\`bash
${pm === 'npm' ? 'npm start' : pm === 'yarn' ? 'yarn start' : 'pnpm start'}
\`\`\`

Then scan the QR code with the Expo Go app (iOS/Android).

## Assets

The \`assets/\` folder contains SVG placeholder files for your app icons and splash screen.

**Before publishing**, you need to convert these to PNG format:
- \`icon.svg\` → \`icon.png\` (1024x1024)
- \`splash.svg\` → \`splash.png\` (1284x2778)
- \`adaptive-icon.svg\` → \`adaptive-icon.png\` (1024x1024)
- \`favicon.svg\` → \`favicon.png\` (48x48)

You can use tools like:
- [SVGOMG](https://jakearchibald.github.io/svgomg/) - Online SVG optimizer
- [CloudConvert](https://cloudconvert.com/svg-to-png) - SVG to PNG converter
- Or any design tool (Figma, Sketch, etc.)

After converting, update \`app.json\` to reference the \`.png\` files instead of \`.svg\`.

## Learn More
- [Expo Documentation](https://docs.expo.dev/)
- [Expo Icons Guide](https://docs.expo.dev/develop/user-interface/app-icons/)
- [React Native Documentation](https://reactnative.dev/)
`;

const babelConfig = `module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

// ============================================================================
// PLACEHOLDER ASSETS
// ============================================================================

/**
 * Generate a simple SVG placeholder that can be used as a PNG substitute.
 * Expo will show a warning but won't crash - users should replace with real assets.
 *
 * For production apps, these should be replaced with proper PNG files.
 */

/**
 * Generate placeholder icon SVG (1024x1024)
 * Uses design pack colors for the icon
 */
const getIconPlaceholder = (pack?: DesignPack): string => {
  const bg = pack?.tokens.colors.primary || '#0ea5e9';
  const fg = pack?.tokens.colors.primary_foreground || '#ffffff';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${bg}"/>
  <circle cx="512" cy="400" r="200" fill="${fg}" opacity="0.9"/>
  <rect x="312" y="550" width="400" height="300" rx="40" fill="${fg}" opacity="0.9"/>
  <text x="512" y="950" font-family="system-ui, sans-serif" font-size="80" fill="${fg}" text-anchor="middle" opacity="0.6">Replace with icon</text>
</svg>`;
};

/**
 * Generate placeholder splash SVG (1284x2778 - iPhone 14 Pro Max size)
 * Uses design pack colors
 */
const getSplashPlaceholder = (appName: string, pack?: DesignPack): string => {
  const bg = pack?.tokens.colors.background || '#ffffff';
  const fg = pack?.tokens.colors.foreground || '#000000';
  const accent = pack?.tokens.colors.accent || '#0ea5e9';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1284" height="2778" viewBox="0 0 1284 2778">
  <rect width="1284" height="2778" fill="${bg}"/>
  <circle cx="642" cy="1200" r="150" fill="${accent}" opacity="0.9"/>
  <text x="642" y="1500" font-family="system-ui, sans-serif" font-size="72" font-weight="bold" fill="${fg}" text-anchor="middle">${appName}</text>
  <text x="642" y="1600" font-family="system-ui, sans-serif" font-size="36" fill="${fg}" text-anchor="middle" opacity="0.5">Built with Ordinex</text>
</svg>`;
};

/**
 * Generate placeholder adaptive icon SVG (1024x1024)
 * For Android adaptive icons
 */
const getAdaptiveIconPlaceholder = (pack?: DesignPack): string => {
  const accent = pack?.tokens.colors.accent || '#0ea5e9';
  const fg = pack?.tokens.colors.accent_foreground || '#ffffff';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="transparent"/>
  <circle cx="512" cy="512" r="400" fill="${accent}"/>
  <circle cx="512" cy="400" r="150" fill="${fg}" opacity="0.9"/>
  <rect x="362" y="500" width="300" height="220" rx="30" fill="${fg}" opacity="0.9"/>
</svg>`;
};

/**
 * Generate placeholder favicon SVG (48x48)
 * For web favicon
 */
const getFaviconPlaceholder = (pack?: DesignPack): string => {
  const bg = pack?.tokens.colors.primary || '#0ea5e9';
  const fg = pack?.tokens.colors.primary_foreground || '#ffffff';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="${bg}"/>
  <circle cx="24" cy="20" r="10" fill="${fg}" opacity="0.9"/>
  <rect x="14" y="26" width="20" height="14" rx="4" fill="${fg}" opacity="0.9"/>
</svg>`;
};

export const expoRecipe: RecipeBuilder = {
  id: 'expo',
  build(ctx: RecipeContext): RecipePlan {
    const { app_name, target_directory, package_manager, design_pack } = ctx;
    const pm = package_manager;

    // Use design pack if provided, otherwise fall back to mobile-friendly default
    const pack = design_pack || DESIGN_PACKS.find(p => p.id === 'vibrant-pop');

    const files: FilePlanItem[] = [
      { path: 'package.json', kind: 'file', content: packageJson(app_name), description: 'Project manifest' },
      { path: 'app.json', kind: 'file', content: getAppJson(app_name, pack), description: 'Expo configuration with design colors' },
      { path: 'tsconfig.json', kind: 'file', content: tsconfig, description: 'TypeScript configuration' },
      { path: 'babel.config.js', kind: 'file', content: babelConfig, description: 'Babel configuration' },
      { path: 'App.tsx', kind: 'file', content: getAppTsx(app_name, pack), description: 'Root App component with design tokens' },
      { path: '.gitignore', kind: 'file', content: gitignore, description: 'Git ignore rules' },
      { path: 'README.md', kind: 'file', content: readme(app_name, pm), description: 'Project documentation' },
      // Asset directory and placeholder files
      { path: 'assets', kind: 'dir', description: 'Asset files directory' },
      { path: 'assets/icon.svg', kind: 'file', content: getIconPlaceholder(pack), description: 'App icon placeholder (replace with PNG)' },
      { path: 'assets/splash.svg', kind: 'file', content: getSplashPlaceholder(app_name, pack), description: 'Splash screen placeholder (replace with PNG)' },
      { path: 'assets/adaptive-icon.svg', kind: 'file', content: getAdaptiveIconPlaceholder(pack), description: 'Android adaptive icon placeholder (replace with PNG)' },
      { path: 'assets/favicon.svg', kind: 'file', content: getFaviconPlaceholder(pack), description: 'Web favicon placeholder (replace with PNG)' },
    ];

    const commands: CommandPlanItem[] = [
      { label: 'Install dependencies', cmd: getInstallCommand(pm), cwd: target_directory, when: 'post_apply', description: 'Install npm packages' },
      { label: 'Start Expo', cmd: `${getRunCommand(pm)} start`, cwd: target_directory, when: 'user_explicit', description: 'Start Expo development server' },
    ];

    return {
      recipe_id: 'expo',
      package_manager: pm,
      files,
      commands,
      notes: [
        'Uses Expo SDK 50',
        'TypeScript enabled',
        'Ready for iOS/Android/Web',
        pack ? `Design: ${pack.name} (${pack.vibe})` : 'Default vibrant styling',
      ],
      design_pack_id: pack?.id,
      design_tokens_summary: pack ? `${pack.tokens.colors.primary} | ${pack.tokens.fonts.heading}` : undefined,
      preview_asset_id: pack?.preview.imageAssetId,
    };
  },
};
