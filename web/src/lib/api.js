import { client } from "./edgespark";

export async function api(path, init) {
  const response = await client.api.fetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const code = payload.error?.code || (payload.error === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "REQUEST_FAILED");
    const messages = {
      UNAUTHENTICATED: "登录状态已失效，请重新登录后继续查看任务。",
      FORBIDDEN: "当前账号没有执行这个操作的权限。",
    };
    const error = new Error(messages[code] || payload.error?.message || payload.error || `请求失败（${response.status}）`);
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return payload.data ?? payload;
}

export function jsonInit(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
