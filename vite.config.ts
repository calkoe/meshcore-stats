import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

// Baut die komplette Anwendung in eine einzige index.html. React, Leaflet und
// das Leaflet-CSS werden mit einkompiliert - kein CDN zur Laufzeit.
//
// Eine Ausnahme gibt es und sie ist unvermeidlich: die Kartenkacheln. Sie
// kommen zur Laufzeit von tile.openstreetmap.org, eine Weltkarte laesst sich
// nicht in eine HTML-Datei legen. Ohne Netz bleibt der Kartengrund leer, die
// Topologie selbst wird trotzdem gezeichnet. Der Build-Workflow prueft, dass
// tile.openstreetmap.org der EINZIGE fremde Host bleibt.
export default defineConfig({
  base: './',
  // Einzige Quelle der Version ist package.json - siehe src/version.ts.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    // Leaflet bringt PNGs fuer Marker und Bedienelemente mit; die werden als
    // data:-URI eingebettet, sonst waere der Build nicht mehr single-file.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
    reportCompressedSize: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
