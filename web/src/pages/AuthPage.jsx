import { useState } from "react";
import { BrainCircuit, Eye, EyeOff, LoaderCircle, LockKeyhole, Sparkles, WandSparkles } from "lucide-react";
import { client } from "../lib/edgespark";

export function AuthPage() {
  const [mode, setMode] = useState("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!email.includes("@")) return setError("请填写有效的邮箱地址。");
    if (password.length < 8) return setError("密码至少需要 8 位。");
    if (mode === "register" && !name.trim()) return setError("请填写你的称呼。");
    setLoading(true);
    try {
      if (mode === "register" && inviteCode.trim()) {
        window.sessionStorage.setItem("poster.pending-invite", inviteCode.trim());
      }
      const result = mode === "register"
        ? await client.auth.signUp.email({ name: name.trim(), email: email.trim().toLowerCase(), password })
        : await client.auth.signIn.email({ email: email.trim().toLowerCase(), password });
      if (result?.error) throw new Error(result.error.message || "登录失败，请检查信息后重试。");
    } catch (submitError) {
      if (mode === "register") window.sessionStorage.removeItem("poster.pending-invite");
      setError(submitError.message || "暂时无法完成，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel" aria-label="产品介绍">
        <div className="auth-brand"><span><WandSparkles size={26} /></span>朋友圈海报智能体</div>
        <div className="auth-brand-copy">
          <p><Sparkles size={17} /> 一次生成完整海报</p>
          <h1>把朋友圈内容，变成一张能直接发布的图。</h1>
          <ul>
            <li><BrainCircuit size={20} /><span><strong>DeepSeek 先做方案</strong>理解内容、判断生活类或营销类</span></li>
            <li><WandSparkles size={20} /><span><strong>Image2 一稿生成</strong>画面、人物、中文和排版同时完成</span></li>
            <li><LockKeyhole size={20} /><span><strong>每个人独立使用</strong>API Key 加密保存，作品互不混用</span></li>
          </ul>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">WELCOME</span>
          <h2>{mode === "register" ? "注册你的创作空间" : "欢迎回来"}</h2>
          <p>{mode === "register" ? "邮箱注册后立即可登录，不需要邮件验证。" : "登录后继续查看你的作品和生成任务。"}</p>

          <div className="auth-mode-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button>
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && <label>你的称呼<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="例如：小美" /></label>}
            <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" /></label>
            <label>密码<div className="auth-password"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="至少 8 位" /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
            {mode === "register" && <label>暗号 <small>可选，填写后免年费</small><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" placeholder="没有暗号可以留空" /></label>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={20} />正在处理</> : mode === "register" ? "注册并进入" : "登录"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
