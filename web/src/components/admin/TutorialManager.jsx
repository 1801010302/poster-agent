import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudUpload,
  Film,
  LoaderCircle,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, jsonInit } from "../../lib/api.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)) : "—";
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

function uploadFailure(request, fallback) {
  const code = xmlValue(request.responseText, "Code");
  const detail = xmlValue(request.responseText, "Message");
  const status = request.status ? `HTTP ${request.status}` : "网络连接中断";
  if (code && detail) return new Error(`OSS ${code}：${detail}`);
  if (code) return new Error(`OSS ${code}（${status}）`);
  return new Error(`${fallback}（${status}）`);
}

function uploadDirectly(uploadUrl, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl, true);
    Object.entries(headers || {}).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(uploadFailure(request, "OSS 拒绝接收视频"));
      }
    };
    request.onerror = () => reject(uploadFailure(request, "连接 OSS 时上传中断，请检查网络后重试"));
    request.onabort = () => reject(new Error("上传已取消。"));
    request.send(file);
  });
}

function statusLabel(status) {
  return { active: "当前发布", archived: "已归档", uploading: "待校验", failed: "校验失败" }[status] || status;
}

export function TutorialManager({ data, onChange }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(null);
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function chooseFile(event) {
    const selected = event.target.files?.[0] || null;
    setError("");
    setMessage("");
    setDurationSeconds(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!selected) {
      setFile(null);
      setPreviewUrl("");
      return;
    }
    if (!selected.name.toLowerCase().endsWith(".mp4") || (selected.type && selected.type !== "video/mp4")) {
      setFile(null);
      setPreviewUrl("");
      setError("请选择 MP4 文件，建议使用 H.264 视频编码和 AAC 音频编码。 ");
      event.target.value = "";
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setStage("idle");
    setProgress(0);
  }

  async function refreshData() {
    const next = await api("/api/admin/tutorials");
    onChange(next);
    return next;
  }

  async function handlePublish(event) {
    event.preventDefault();
    if (!file) {
      setError("请先选择要上传的 MP4 视频。 ");
      return;
    }
    setStage("uploading");
    setProgress(0);
    setError("");
    setMessage("正在创建安全上传通道…");
    let activeUploadId = "";
    try {
      const slot = await api("/api/admin/tutorials/uploads", jsonInit("POST", {
        title,
        description,
        fileName: file.name,
        sizeBytes: file.size,
        durationSeconds,
      }));
      activeUploadId = slot.uploadId;
      setMessage("视频正在直接上传到阿里云 OSS，请保持当前页面打开。 ");
      await uploadDirectly(slot.uploadUrl, slot.requiredHeaders, file, setProgress);
      setStage("verifying");
      setProgress(100);
      setMessage("上传完成，正在校验文件完整性并发布…");
      await api(`/api/admin/tutorials/${slot.uploadId}/finalize`, jsonInit("POST", {}));
      await refreshData();
      setStage("success");
      setMessage("新手教学已发布，旧版本已安全归档。 ");
      setFile(null);
      setPreviewUrl("");
      setDurationSeconds(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (publishError) {
      if (activeUploadId) {
        api(`/api/admin/tutorials/${activeUploadId}/failure`, jsonInit("POST", {
          message: publishError.message || "浏览器上传中断，请重新上传。",
        })).catch(() => undefined);
      }
      setStage("error");
      setError(publishError.message || "上传没有完成，请重试。 ");
      setMessage("");
      refreshData().catch(() => undefined);
    }
  }

  const busy = stage === "uploading" || stage === "verifying";
  const current = data?.current || null;

  return (
    <div className="admin-content tutorial-admin-content">
      {!data?.ossConfigured && (
        <div className="tutorial-config-warning" role="alert">
          <AlertTriangle size={20} />
          <div><strong>OSS 安全密钥尚未配置</strong><span>请先通过 EdgeSpark 安全填写页面配置密钥，密钥不会进入网页或数据库。</span></div>
        </div>
      )}

      <div className="tutorial-admin-grid">
        <section className="admin-panel tutorial-upload-panel">
          <div className="admin-panel-heading">
            <div><span className="admin-panel-icon"><CloudUpload size={18} /></span><div><h2>上传并发布新教学</h2><p>视频从浏览器直接上传到阿里云 OSS</p></div></div>
            <span className="tutorial-security-tag"><ShieldCheck size={15} /> 服务端安全签名</span>
          </div>
          <form className="tutorial-upload-form" onSubmit={handlePublish}>
            <label className="tutorial-field"><span>教学标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={80} required placeholder="例如：3 分钟完成第一张朋友圈海报" /></label>
            <label className="tutorial-field"><span>教学说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1200} rows={4} placeholder="告诉用户这段视频能学会什么，以及观看前需要准备什么。" /></label>

            <div className="tutorial-file-zone">
              <input ref={fileInputRef} className="visually-hidden" id="tutorial-video-file" type="file" accept="video/mp4,.mp4" onChange={chooseFile} disabled={busy} />
              <label htmlFor="tutorial-video-file" className="tutorial-file-picker">
                <span><Film size={24} /></span>
                <div><strong>{file ? "重新选择视频" : "选择 MP4 视频"}</strong><small>建议 H.264 + AAC；视频会通过安全签名直接上传 OSS</small></div>
              </label>
              {file && <div className="tutorial-file-meta"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {formatDuration(durationSeconds)}</span></div>}
            </div>

            {previewUrl && <video className="tutorial-local-preview" src={previewUrl} controls playsInline preload="metadata" onLoadedMetadata={(event) => setDurationSeconds(Math.round(event.currentTarget.duration))}>你的浏览器不支持视频预览。</video>}

            {(busy || progress > 0) && (
              <div className="tutorial-progress" aria-live="polite">
                <div><span>{stage === "verifying" ? "完整性校验" : "上传进度"}</span><strong>{progress}%</strong></div>
                <span role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></span>
              </div>
            )}
            {message && <p className={`tutorial-feedback is-${stage}`}><CheckCircle2 size={18} />{message}</p>}
            {error && <p className="tutorial-feedback is-error" role="alert"><AlertTriangle size={18} />{error}</p>}

            <button className="tutorial-publish-button" type="submit" disabled={busy || !data?.ossConfigured}>
              {busy ? <LoaderCircle className="spin" size={20} /> : stage === "error" ? <RotateCcw size={20} /> : <CloudUpload size={20} />}
              {stage === "uploading" ? `正在上传 ${progress}%` : stage === "verifying" ? "正在校验并发布" : stage === "error" ? "重新上传并发布" : "上传并发布"}
            </button>
          </form>
        </section>

        <section className="admin-panel tutorial-current-panel">
          <div className="admin-panel-heading">
            <div><span className="admin-panel-icon is-lime"><PlayCircle size={18} /></span><div><h2>当前线上教学</h2><p>用户进入“新手教学”时看到的内容</p></div></div>
            {current && <span className="admin-status is-active">已发布</span>}
          </div>
          {current ? (
            <div className="tutorial-current-body">
              <video src={current.playUrl} controls playsInline preload="metadata">你的浏览器不支持视频播放。</video>
              <div><h3>{current.title}</h3><p>{current.description || "暂无教学说明"}</p></div>
              <dl>
                <div><dt>文件</dt><dd>{current.fileName}</dd></div>
                <div><dt>大小</dt><dd>{formatBytes(current.sizeBytes)}</dd></div>
                <div><dt>时长</dt><dd>{formatDuration(current.durationSeconds)}</dd></div>
                <div><dt>发布时间</dt><dd>{formatDate(current.publishedAt)}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="tutorial-current-empty"><PlayCircle size={34} /><strong>还没有发布教学视频</strong><p>左侧视频上传并通过完整性校验后，会自动在这里显示。</p></div>
          )}
        </section>
      </div>

      <section className="admin-panel tutorial-history-panel">
        <div className="admin-panel-heading"><div><span className="admin-panel-icon is-orange"><Clock3 size={18} /></span><div><h2>发布记录</h2><p>旧版本只归档记录，不自动删除 OSS 文件</p></div></div><span>最近 {data?.items?.length || 0} 条</span></div>
        {data?.items?.length ? <div className="admin-table-wrap"><table><thead><tr><th>标题</th><th>文件</th><th>状态</th><th>发布时间</th><th>校验说明</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{item.description || "暂无说明"}</small></td><td><strong>{item.fileName}</strong><small>{formatBytes(item.sizeBytes)} · {formatDuration(item.durationSeconds)}</small></td><td><span className={`admin-status is-${item.status}`}>{statusLabel(item.status)}</span></td><td>{formatDate(item.publishedAt || item.createdAt)}</td><td>{item.validationError || "—"}</td></tr>)}</tbody></table></div> : <div className="admin-empty-compact">还没有教学视频记录。</div>}
      </section>
    </div>
  );
}
