import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom'],
                    'vendor-zustand': ['zustand'],
                    'vendor-monaco': ['@monaco-editor/react', 'monaco-editor'],
                    'vendor-xterm': ['xterm', 'xterm-addon-fit', 'xterm-addon-unicode11', 'xterm-addon-webgl'],
                    'vendor-ui': ['react-hook-form', '@hookform/resolvers', 'zod', 'sonner']
                }
            }
        }
    }
});
