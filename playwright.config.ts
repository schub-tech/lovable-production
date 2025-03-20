import { defineConfig } from '@playwright/test';
import { config as appConfig } from './tests/config/config'; // Import your existing config

export default defineConfig({
  webServer: {
    command: 'npm run dev',  // Command to start your server (or 'npm start')
    url: appConfig.baseUrl, // Use the baseUrl from your existing config
    timeout: 120000, // Wait up to 2 minutes for the server to start
    reuseExistingServer: !process.env.CI, // Optionally reuse server in CI
  },
  use: {
    baseURL: appConfig.baseUrl, // Use the same base URL for your tests
  },
});
