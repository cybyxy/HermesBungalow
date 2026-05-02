/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend port when using direct WS in dev (default 8000). */
  readonly VITE_BACKEND_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
