import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

function tvLegacyPlugin() {
  return {
    name: 'tv-legacy-plugin',
    transformIndexHtml(html: string) {
      // Replace type="module" script tags with standard deferred script tags
      // This is crucial for older Smart TV browsers that do not support ES Modules
      return html.replace(/type="module"/g, 'defer');
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      tvLegacyPlugin()
    ],
    build: {
      target: 'es2015',
      cssTarget: 'chrome49',
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          format: 'umd' as const,
          name: 'App',
          inlineDynamicImports: true,
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
