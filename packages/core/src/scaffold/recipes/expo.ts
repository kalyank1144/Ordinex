/**
 * Expo (React Native) Recipe (Step 35.3)
 * 
 * Minimal runnable Expo project for iOS/Android.
 * TypeScript by default, ~8-12 files.
 */

import { RecipeBuilder, RecipeContext, RecipePlan, FilePlanItem, CommandPlanItem } from '../recipeTypes';
import { getInstallCommand, getRunCommand } from '../recipeSelector';

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

const appJson = (appName: string) => `{
  "expo": {
    "name": "${appName}",
    "slug": "${appName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      }
    },
    "web": {
      "favicon": "./assets/favicon.png"
    }
  }
}
`;

const tsconfig = `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}
`;

const appTsx = (appName: string) => `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>${appName}</Text>
      <Text style={styles.subtitle}>Welcome to your Expo app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
`;

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

## Learn More
- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
`;

const babelConfig = `module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

export const expoRecipe: RecipeBuilder = {
  id: 'expo',
  build(ctx: RecipeContext): RecipePlan {
    const { app_name, target_directory, package_manager } = ctx;
    const pm = package_manager;
    
    const files: FilePlanItem[] = [
      { path: 'package.json', kind: 'file', content: packageJson(app_name), description: 'Project manifest' },
      { path: 'app.json', kind: 'file', content: appJson(app_name), description: 'Expo configuration' },
      { path: 'tsconfig.json', kind: 'file', content: tsconfig, description: 'TypeScript configuration' },
      { path: 'babel.config.js', kind: 'file', content: babelConfig, description: 'Babel configuration' },
      { path: 'App.tsx', kind: 'file', content: appTsx(app_name), description: 'Root App component' },
      { path: '.gitignore', kind: 'file', content: gitignore, description: 'Git ignore rules' },
      { path: 'README.md', kind: 'file', content: readme(app_name, pm), description: 'Project documentation' },
      { path: 'assets', kind: 'dir', description: 'Asset files directory' },
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
      notes: ['Uses Expo SDK 50', 'TypeScript enabled', 'Ready for iOS/Android/Web'],
    };
  },
};
