import { api, jsonInit } from "../lib/api";

function generationError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("任务已取消", "AbortError"));
    }, { once: true });
  });
}

async function uploadReferenceFile(file, signal) {
  const signed = await api("/api/assets/presign", jsonInit("POST", {
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  }));
  const response = await fetch(signed.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { ...signed.requiredHeaders, "Content-Type": file.type },
    signal,
  });
  if (!response.ok) throw new Error("参考图上传失败，请重新选择后再试。");
  return signed;
}

async function uploadReference(source, role, signal) {
  if (source?.path) return { path: source.path, role };
  if (!source?.file) return null;
  const signed = await uploadReferenceFile(source.file, signal);
  return { path: signed.path, role };
}

async function prepareLivePayload(payload, signal, onProgress) {
  const entries = [
    ["人物参考图", payload.assets?.person],
    ["产品或课程封面", payload.assets?.product],
    ["品牌 Logo", payload.assets?.logo],
  ].filter(([, source]) => Boolean(source));
  const referenceAssets = [];
  for (let index = 0; index < entries.length; index += 1) {
    const [role, source] = entries[index];
    const asset = await uploadReference(source, role, signal);
    if (asset) referenceAssets.push(asset);
    onProgress?.(12 + Math.round(((index + 1) / entries.length) * 10));
  }
  return { ...payload, assets: undefined, referenceAssets, idempotencyKey: crypto.randomUUID() };
}

async function readBridgeResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw generationError(payload.error?.message || payload.error || `Image2 请求失败（${response.status}）`, {
      code: payload.error?.code || `IMAGE2_HTTP_${response.status}`,
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return payload;
}

async function bridgeFetch(url, init, stage) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await wait(700 * (attempt + 1), init.signal);
        continue;
      }
      return response;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
      if (attempt < 2) await wait(700 * (attempt + 1), init.signal);
    }
  }
  throw generationError(stage === "submit" ? "Image2 安全连接暂时不可用，任务已保留。" : "Image2 任务状态暂时无法读取，任务已保留。", {
    code: "BRIDGE_NETWORK",
    stage,
    retryable: true,
    cause: lastError,
  });
}

async function reportFailure(job, error, stage) {
  if (!job?.id && !job?.taskId) return null;
  try {
    return await api(`/api/image/tasks/${encodeURIComponent(job.taskId || job.id)}/failure`, jsonInit("POST", {
      code: error?.code || "GENERATION_FAILED",
      message: error?.message || "生成失败",
      status: error?.status || 0,
      stage,
    }));
  } catch {
    return null;
  }
}

async function submitThroughBridge(job, signal) {
  const bridge = job?.bridge;
  if (!bridge || bridge.action !== "submit") return job;
  const response = await bridgeFetch(`${bridge.baseUrl}/bridge/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": bridge.idempotencyKey,
        "X-Image2-Bridge": bridge.envelope,
      },
      body: JSON.stringify(bridge.request),
      signal,
    }, "submit");
  const payload = await readBridgeResponse(response);
  const taskId = String(payload.task_id || payload.taskId || payload.id || "").trim();
  if (!taskId) throw generationError("Image2 已接收请求，但没有返回任务编号。", { code: "MISSING_TASK_ID", stage: "submit", retryable: true });
  return api(`/api/image/tasks/${encodeURIComponent(job.taskId || job.id)}/accept`, jsonInit("POST", { taskId }));
}

async function pollThroughBridge(job, signal, progress) {
  const bridge = job?.bridge;
  if (!bridge || bridge.action !== "poll" || !bridge.taskId) return job;
  const response = await bridgeFetch(`${bridge.baseUrl}/bridge/tasks/${encodeURIComponent(bridge.taskId)}`, {
      method: "GET",
      headers: { "X-Image2-Bridge": bridge.envelope },
      signal,
    }, "poll");
  const payload = await readBridgeResponse(response);
  return api(`/api/image/tasks/${encodeURIComponent(job.taskId || job.id)}/sync`, jsonInit("POST", {
    taskId: bridge.taskId,
    status: payload.status || (payload.completed ? "completed" : "processing"),
    progress,
    imageUrl: payload.result_url || payload.resultUrl || payload.image_url || null,
    archiveUrl: payload.archive_url || payload.archiveUrl || null,
    error: payload.error?.message || payload.error || null,
  }));
}

async function advanceBridge(job, signal, progress) {
  if (job?.bridge?.action === "submit") return submitThroughBridge(job, signal);
  if (job?.bridge?.action === "poll") return pollThroughBridge(job, signal, progress);
  return job;
}

export const imageApi = {
  async getConfig() {
    return api("/api/settings");
  },

  async saveSettings(values) {
    const requests = [];
    if (values.deepseekApiKey?.trim()) {
      requests.push({
        provider: "deepseek",
        label: "DeepSeek",
        request: api("/api/settings/deepseek", jsonInit("POST", { apiKey: values.deepseekApiKey.trim() })),
      });
    }
    if (values.image2ApiKey?.trim()) {
      requests.push({
        provider: "image2",
        label: "Image2",
        request: api("/api/settings/image2", jsonInit("POST", { apiKey: values.image2ApiKey.trim() })),
      });
    }
    const settled = await Promise.allSettled(requests.map((item) => item.request));
    const saveResult = settled.reduce((summary, result, index) => {
      const item = requests[index];
      if (result.status === "fulfilled") summary.saved.push(item);
      else summary.failed.push({ ...item, message: result.reason?.message || "保存失败" });
      return summary;
    }, { saved: [], failed: [] });
    const config = await this.getConfig();
    return { ...config, saveResult };
  },

  async plan(payload) {
    return api("/api/ai/plan", jsonInit("POST", { mode: payload.mode, copy: payload.copy }));
  },

  async getSavedReferences() {
    return api("/api/assets/references");
  },

  async saveReference(role, file, options = {}) {
    const signed = await uploadReferenceFile(file, options.signal);
    return api(`/api/assets/references/${encodeURIComponent(role)}`, jsonInit("PUT", {
      path: signed.path,
      fileName: file.name,
      contentType: file.type,
    }));
  },

  async removeReference(role) {
    return api(`/api/assets/references/${encodeURIComponent(role)}`, { method: "DELETE" });
  },

  async submit(payload, options = {}) {
    options.onProgress?.(10);
    const body = await prepareLivePayload(payload, options.signal, options.onProgress);
    const queued = await api("/api/image/generations", jsonInit("POST", body));
    options.onPersisted?.(queued);
    let task;
    try {
      task = await advanceBridge(queued, options.signal, 24);
    } catch (error) {
      if (error?.name !== "AbortError") {
        const persisted = await reportFailure(queued, error, "submit");
        if (persisted) error.job = persisted;
      }
      throw error;
    }
    options.onProgress?.(24);
    return { ...task, taskId: task.taskId || task.id, startedAt: Date.now() };
  },

  async resume(task, options = {}) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await wait(2000, options.signal);
      let stored = await api(`/api/image/tasks/${encodeURIComponent(task.taskId || task.id)}`);
      if (stored.status === "delayed" || stored.status === "failed") {
        throw generationError(stored.error || "生成任务未完成。", { code: stored.errorCode, job: stored, retryable: stored.retryable });
      }
      const nextProgress = stored.progress || Math.min(95, 25 + Math.floor(attempt / 3));
      try {
        stored = await advanceBridge(stored, options.signal, nextProgress);
      } catch (error) {
        if (error?.name !== "AbortError") {
          const persisted = await reportFailure(stored, error, stored.bridge?.action === "submit" ? "submit" : "poll");
          if (persisted) error.job = persisted;
        }
        throw error;
      }
      options.onProgress?.(stored.progress || nextProgress, stored);
      if (stored.status === "completed") return stored;
      if (stored.status === "delayed" || stored.status === "failed") {
        throw generationError(stored.error || "生成任务未完成。", { code: stored.errorCode, job: stored, retryable: stored.retryable });
      }
    }
    const timeout = generationError("Image2 暂未返回最终结果，已停止自动查询。", { code: "POLL_TIMEOUT", retryable: true });
    const persisted = await reportFailure(task, timeout, "poll");
    if (persisted) timeout.job = persisted;
    throw timeout;
  },

  async retryTask(id, options = {}) {
    const task = await api(`/api/image/tasks/${encodeURIComponent(id)}/retry`, jsonInit("POST", {}));
    try {
      return await advanceBridge(task, options.signal, task.providerTaskId ? Math.max(24, task.progress || 24) : 24);
    } catch (error) {
      if (error?.name !== "AbortError") {
        const persisted = await reportFailure(task, error, task.bridge?.action === "submit" ? "submit" : "poll");
        if (persisted) error.job = persisted;
      }
      throw error;
    }
  },

  async getWorks() {
    return api("/api/works");
  },

  async deleteWork(id) {
    return api(`/api/works/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async getDownloadUrl(id) {
    return api(`/api/works/${encodeURIComponent(id)}/download`);
  },
};
