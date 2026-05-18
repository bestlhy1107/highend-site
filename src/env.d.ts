/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly NEWS_RSS_URL?: string;
  readonly NEWS_RSS_URLS?: string;

  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;

  readonly LEAD_TO_EMAIL?: string;
  readonly MAIL_FROM?: string;

  readonly ADMIN_USERNAME?: string;
  readonly ADMIN_PASSWORD?: string;

  readonly BAIDU_APPBUILDER_API_KEY?: string;
  readonly BAIDU_SEARCH_API_KEY?: string;
  readonly BAIDU_SEARCH_MODEL?: string;

  readonly COLLEGE_SCORECARD_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
