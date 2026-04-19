export type AdminSessionContext = {
  session?: {
    get: (key: string) => Promise<unknown> | unknown;
  };
};

export async function hasAdminSession(context: AdminSessionContext) {
  return Boolean(await context.session?.get("adminUser"));
}

export function unauthorizedJson() {
  return new Response(
    JSON.stringify({ ok: false, message: "请先登录管理员后台" }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }
  );
}
