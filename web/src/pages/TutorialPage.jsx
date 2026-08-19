import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, CirclePlay, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { api } from "../lib/api.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(value) {
  const seconds = Math.round(Number(value || 0));
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function TutorialPage({ onCreate }) {
  const [tutorial, setTutorial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/tutorial");
      setTutorial(result.tutorial || null);
    } catch (loadError) {
      setError(loadError.message || "暂时无法打开新手教学，请稍后重试。 ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="tutorial-page">
      <header className="tutorial-hero">
        <span className="hero-kicker"><Sparkles size={16} /> QUICK START</span>
        <h1>新手教学</h1>
        <p>跟着视频走一遍，从输入朋友圈内容到生成第一张完整海报。</p>
      </header>

      {loading && <div className="tutorial-page-state"><LoaderCircle className="spin" size={28} /><strong>正在准备教学视频</strong></div>}
      {!loading && error && <div className="tutorial-page-state is-error"><RefreshCcw size={28} /><strong>{error}</strong><button type="button" onClick={load}>重新加载</button></div>}
      {!loading && !error && !tutorial && <div className="tutorial-page-state"><BookOpenCheck size={34} /><strong>教学视频正在准备中</strong><p>管理员发布后会在这里自动出现，你可以先开始创作。</p><button type="button" onClick={onCreate}>开始创作</button></div>}
      {!loading && !error && tutorial && (
        <section className="tutorial-viewer">
          <div className="tutorial-video-shell"><video src={tutorial.playUrl} controls playsInline preload="metadata" onError={() => setError("视频链接已过期或网络暂时不可用，请重新加载。 ")}>你的浏览器不支持视频播放。</video></div>
          <article className="tutorial-detail">
            <span><CirclePlay size={18} /> 入门必看</span>
            <h2>{tutorial.title}</h2>
            <p>{tutorial.description || "跟随视频完成一次完整创作，你会更快熟悉整个流程。"}</p>
            <dl><div><dt>视频时长</dt><dd>{formatDuration(tutorial.durationSeconds)}</dd></div><div><dt>文件大小</dt><dd>{formatBytes(tutorial.sizeBytes)}</dd></div></dl>
            <button type="button" onClick={onCreate}>看完了，开始创作</button>
          </article>
        </section>
      )}
    </main>
  );
}
