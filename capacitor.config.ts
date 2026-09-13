import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the future LifeOS iOS shell.
 *
 * This file makes the web project Capacitor-ready. No native platform has
 * been added yet (`npx cap add ios` requires Xcode on a Mac and is
 * intentionally NOT run here). See PROGRESS.md → "iOS/Capacitor readiness"
 * for the exact steps to run on a Mac once this project is copied over.
 */
const config: CapacitorConfig = {
  appId: 'com.lifeos.app',
  appName: 'LifeOS',
  webDir: 'dist',
  backgroundColor: '#0B0D10', // matches --c-surface-base (dark theme default)
  server: {
    androidScheme: 'https',
  },
  ios: {
    // Lets Safari Web Inspector attach to the WKWebView during development.
    // Harmless in production; consider disabling for release builds.
    webContentsDebuggingEnabled: true,
    backgroundColor: '#0B0D10',
    contentInset: 'always',
  },
  android: {
    backgroundColor: '#0B0D10',
  },
};

export default config;
