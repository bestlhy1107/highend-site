/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly NEWS_RSS_URL?: string;
  readonly NEWS_RSS_URLS?: string;

  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;

  readonly CONTACT_TO?: string;
  readonly CONTACT_FROM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}