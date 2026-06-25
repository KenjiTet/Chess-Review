/** Type declarations for static asset imports. */

// Types for the vite-plugin-pwa virtual module (registerSW, etc.).
/// <reference types="vite-plugin-pwa/client" />

declare module '*.mp3' {
  const src: string;
  export default src;
}
