/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_DOWNLOAD_URL?: string;
  readonly VITE_DOWNLOAD_NAME?: string;
  readonly VITE_DOWNLOAD_SIZE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
