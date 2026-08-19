import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Clock3,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Plus,
  QrCode,
  RefreshCcw,
  Sparkles,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
  Type,
  UploadCloud,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { imageApi } from "./services/imageApi.js";
import { useAuth } from "./hooks/useAuth.js";
import { api, jsonInit } from "./lib/api.js";
import { AuthPage } from "./pages/AuthPage.jsx";
import { AccessPage } from "./pages/AccessPage.jsx";
import { AdminPage } from "./pages/AdminPage.jsx";
import { TutorialPage } from "./pages/TutorialPage.jsx";

const DEFAULT_COPY = "";

const RUNNING_JOB_STATUSES = new Set(["queued", "submitting", "processing", "preparing", "generating"]);
const APP_PAGES = new Set(["create", "works", "tutorial", "admin"]);

function pageFromLocation() {
  const page = window.location.hash.replace(/^#\/?/u, "").split("/")[0];
  return APP_PAGES.has(page) ? page : "create";
}

function jobStateMeta(job) {
  const status = job?.status || "queued";
  const values = {
    queued: { label: "等待提交", title: "任务正在排队", detail: "正在准备连接 Image2，请勿重复提交。", active: true },
    submitting: { label: "正在提交", title: "正在提交给 Image2", detail: "正在安全提交生成要求，通常只需几秒。", active: true },
    preparing: { label: "正在准备", title: "正在准备素材", detail: "正在上传参考素材并整理生成请求。", active: true },
    generating: { label: "生成中", title: "Image2 正在生成", detail: "可以放到后台，离开当前页面不会中断任务。", active: true },
    processing: { label: "生成中", title: "Image2 正在生成", detail: "可以放到后台，离开当前页面不会中断任务。", active: true },
    delayed: { label: "等待继续", title: "本次等待时间较长", detail: job?.error || "已停止自动查询，继续查询原任务不会重复扣费。", recoverable: true },
    failed: { label: "生成失败", title: "这次没有生成成功", detail: job?.error || "请根据失败原因处理后再试。", recoverable: Boolean(job?.retryable) },
    completed: { label: "已完成", title: "海报已完成", detail: "结果已经保存到我的作品。" },
  };
  return values[status] || values.queued;
}

const SAMPLE_PROJECTS = [
  {
    id: 1,
    title: "零基础AI内容变现营",
    type: "课程推广",
    ratio: "2:3",
    date: "刚刚",
    status: "已完成",
    image: "/assets/generated-poster.png",
  },
  {
    id: 2,
    title: "7天内容系统搭建",
    type: "观点表达",
    ratio: "4:3",
    date: "昨天 19:42",
    status: "已完成",
    image: "/assets/course-cover.png",
  },
];

const ACTIVE_JOB_STORAGE = "poster-agent.active-job";
const PROJECTS_STORAGE = "poster-agent.generated-projects";

function readLocalJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is helpful but must never block generation.
  }
}

function Brand() {
  return (
    <button className="brand" type="button" aria-label="返回创作首页">
      <span className="brand-mark" aria-hidden="true">
        <WandSparkles size={24} strokeWidth={2.4} />
      </span>
      <span>朋友圈海报智能体</span>
    </button>
  );
}

function Header({ page, onNavigate, apiConfig, onOpenSettings, activeJob, onOpenJob, user, access, onSignOut, onOpenAdmin }) {
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <div onClick={() => onNavigate("create")}>
          <Brand />
        </div>

        <nav className="desktop-nav" aria-label="主导航">
          <button
            className={page === "create" || page === "result" ? "is-active" : ""}
            onClick={() => onNavigate("create")}
            type="button"
          >
            开始创作
          </button>
          <button
            className={page === "works" ? "is-active" : ""}
            onClick={() => onNavigate("works")}
            type="button"
          >
            我的作品
          </button>
          <button
            className={page === "tutorial" ? "is-active" : ""}
            onClick={() => onNavigate("tutorial")}
            type="button"
          >
            新手教学
          </button>
        </nav>

        <div className="header-actions">
          {activeJob && (
            <button className={`job-status-button is-${activeJob.status}`} type="button" onClick={onOpenJob}>
              {activeJob.status === "completed" ? <CircleCheckBig size={17} /> : <LoaderCircle className="spin" size={17} />}
              <span>{activeJob.status === "completed" ? "海报已完成" : activeJob.id ? `后台生成 ${activeJob.progress || 8}%` : `正在准备 ${activeJob.progress || 8}%`}</span>
            </button>
          )}
          {apiConfig?.allConfigured ? (
            <span className="demo-badge is-live">AI 服务已连接</span>
          ) : (
            <span className="demo-badge">服务待配置</span>
          )}
          <button className="settings-button" type="button" onClick={onOpenSettings} aria-label="服务设置">
            <Settings2 size={18} /> <span>服务设置</span>
          </button>
          <div className="profile-wrap">
            <button
              className="profile-button"
              type="button"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((value) => !value)}
            >
              <span className="profile-avatar" aria-hidden="true">{(user?.name || user?.email || "用").slice(0, 1).toUpperCase()}</span>
              <span>{user?.name || "我的账号"}</span>
              <ChevronDown size={17} />
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu">
                <p className="profile-email">{user?.email}</p>
                {access?.role === "admin" && <button type="button" role="menuitem" onClick={onOpenAdmin}><ShieldCheck size={17} /> 管理后台</button>}
                <button type="button" role="menuitem" onClick={onSignOut}><LogOut size={17} /> 退出登录</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <nav className={`mobile-nav ${access?.role === "admin" ? "has-admin" : ""}`} aria-label="移动端主导航">
        <button className={page === "create" || page === "result" ? "is-active" : ""} type="button" onClick={() => onNavigate("create")}>
          <Sparkles size={18} /> <span>开始创作</span>
        </button>
        <button className={page === "works" ? "is-active" : ""} type="button" onClick={() => onNavigate("works")}>
          <LayoutGrid size={18} /> <span>我的作品</span>
        </button>
        <button className={page === "tutorial" ? "is-active" : ""} type="button" onClick={() => onNavigate("tutorial")}>
          <BookOpenCheck size={18} /> <span>新手教学</span>
        </button>
        {access?.role === "admin" && (
          <button type="button" onClick={onOpenAdmin}>
            <ShieldCheck size={18} /> <span>管理后台</span>
          </button>
        )}
      </nav>
    </header>
  );
}

function SettingsDialog({ config, onClose, onSaved }) {
  const [image2ApiKey, setImage2ApiKey] = useState("");
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [showImage2Key, setShowImage2Key] = useState(false);
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function handleSave(event) {
    event.preventDefault();
    if (!image2ApiKey.trim() && !deepseekApiKey.trim()) {
      setError("请至少填写一个需要配置或替换的 API Key。");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const next = await imageApi.saveSettings({ image2ApiKey, deepseekApiKey });
      onSaved(next);
      const savedProviders = new Set(next.saveResult?.saved.map((item) => item.provider) || []);
      if (savedProviders.has("image2")) setImage2ApiKey("");
      if (savedProviders.has("deepseek")) setDeepseekApiKey("");
      if (next.saveResult?.failed.length) {
        setError(next.saveResult.failed.map((item) => `${item.label}：${item.message}`).join("；"));
        if (next.saveResult.saved.length) {
          setMessage(`${next.saveResult.saved.map((item) => item.label).join("、")} 已保存，其他服务可以稍后单独重试。`);
        }
      } else {
        setMessage("保存成功，新的服务配置已经立即生效。");
      }
    } catch (saveError) {
      setError(saveError.message || "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-scrim settings-scrim" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-dialog-heading">
          <div>
            <span className="eyebrow">AI SERVICE SETTINGS</span>
            <h2 id="settings-title">服务设置</h2>
            <p>DeepSeek 负责策划，Image2 负责一次生成完整海报。</p>
          </div>
          <button className="settings-close" type="button" onClick={onClose} aria-label="关闭服务设置">
            <X size={22} />
          </button>
        </div>

        <form className="settings-form" onSubmit={handleSave}>
          <div className="settings-provider">
            <div className="provider-heading">
              <span className="provider-icon is-deepseek"><BrainCircuit size={23} /></span>
              <div>
                <h3>DeepSeek 推理服务</h3>
                <p>理解内容、判断类型、提炼文字与视觉方案</p>
              </div>
              <span className={`provider-status ${config?.deepseekConfigured ? "is-ready" : ""}`}>
                {config?.deepseekConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <label htmlFor="deepseek-api-key">DeepSeek API Key</label>
            <div className="secret-input">
              <KeyRound size={19} aria-hidden="true" />
              <input
                id="deepseek-api-key"
                type={showDeepseekKey ? "text" : "password"}
                value={deepseekApiKey}
                onChange={(event) => setDeepseekApiKey(event.target.value)}
                placeholder={config?.deepseekConfigured ? "已保存，填写新 Key 可替换" : "输入 sk-..."}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowDeepseekKey((value) => !value)} aria-label={showDeepseekKey ? "隐藏 DeepSeek Key" : "显示 DeepSeek Key"}>
                {showDeepseekKey ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <a
              className="newbie-key-link"
              href="https://platform.deepseek.com/sign_in"
              target="_blank"
              rel="noreferrer"
            >
              <span><strong>还没有 Key？</strong> 前往 DeepSeek 官方登录获取</span>
              <ExternalLink size={18} aria-hidden="true" />
            </a>
          </div>

          <div className="settings-provider">
            <div className="provider-heading">
              <span className="provider-icon is-image2"><WandSparkles size={23} /></span>
              <div>
                <h3>Image2 生图服务</h3>
                <p>一次生成画面、人物、中文文字与排版</p>
              </div>
              <span className={`provider-status ${config?.image2Configured ? "is-ready" : ""}`}>
                {config?.image2Configured ? "已配置" : "未配置"}
              </span>
            </div>
            <label htmlFor="image2-api-key">Image2 API Key</label>
            <div className="secret-input">
              <KeyRound size={19} aria-hidden="true" />
              <input
                id="image2-api-key"
                type={showImage2Key ? "text" : "password"}
                value={image2ApiKey}
                onChange={(event) => setImage2ApiKey(event.target.value)}
                placeholder={config?.image2Configured ? "已保存，填写新 Key 可替换" : "输入 Image2 Key"}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowImage2Key((value) => !value)} aria-label={showImage2Key ? "隐藏 Image2 Key" : "显示 Image2 Key"}>
                {showImage2Key ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <a
              className="newbie-key-link"
              href="https://openapi.yiminju.xyz/login"
              target="_blank"
              rel="noreferrer"
            >
              <span><strong>还没有 Key？</strong> 前往 Image2 平台登录获取</span>
              <ExternalLink size={18} aria-hidden="true" />
            </a>
          </div>

          <p className="settings-security"><Info size={16} /> Key 会按当前账号加密保存，网页只显示脱敏尾号，不会回显原值。</p>
          {error && <p className="settings-message is-error" role="alert">{error}</p>}
          {message && <p className="settings-message is-success" role="status">{message}</p>}

          <div className="settings-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={saving}>
              {saving ? <><LoaderCircle className="spin" size={19} /> 正在保存</> : <><Check size={19} /> 保存并启用</>}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UploadSlot({ label, value, fallback, onChange, onRemove, optional = false, busy = false }) {
  const inputRef = useRef(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({ url, name: file.name, file });
    event.target.value = "";
  }

  return (
    <div className="upload-field">
      <div className="upload-label-row">
        <span>{label}</span>
        {optional && <small>可选</small>}
      </div>
      <div className={`upload-preview ${value ? "has-image" : ""}`}>
        {value ? (
          <>
            <img src={value.url || value} alt={`${label}预览`} />
            <button
              className="remove-asset"
              type="button"
              aria-label={`移除${label}`}
              onClick={onRemove}
              disabled={busy}
            >
              <X size={17} />
            </button>
            <button
              className="replace-asset"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? "保存中" : "更换"}
            </button>
          </>
        ) : fallback ? (
          <button className="logo-fallback" type="button" onClick={() => inputRef.current?.click()}>
            <WandSparkles size={34} />
            <span>上传 Logo</span>
          </button>
        ) : (
          <button className="empty-upload" type="button" onClick={() => inputRef.current?.click()}>
            <UploadCloud size={28} />
            <span>点击上传</span>
            <small>PNG、JPG 或 WebP</small>
          </button>
        )}
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
          disabled={busy}
        />
      </div>
    </div>
  );
}

function PlanItem({ icon: Icon, title, children, tone = "violet" }) {
  return (
    <div className="plan-item">
      <span className={`plan-icon is-${tone}`} aria-hidden="true">
        <Icon size={26} />
      </span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function FlowSteps({ current }) {
  const steps = [
    { number: 1, label: "输入内容", icon: FileText },
    { number: 2, label: "确认方案", icon: BrainCircuit },
    { number: 3, label: "生成海报", icon: ImageIcon },
  ];
  return (
    <ol className="flow-steps" aria-label="海报创作步骤">
      {steps.map(({ number, label, icon: Icon }) => (
        <li key={number} className={current === number ? "is-current" : current > number ? "is-done" : ""}>
          <span>{current > number ? <Check size={19} /> : <Icon size={19} />}</span>
          <div><small>第 {number} 步</small><strong>{label}</strong></div>
        </li>
      ))}
    </ol>
  );
}

function PlanningPanel({
  category, setCategory, ratio, setRatio, qrPosition, setQrPosition,
  visualDirection, setVisualDirection, requiredCopy, setRequiredCopy,
  posterType, reasoningSummary, onAnalyze, planStatus,
}) {
  function updateCopy(index, value) {
    setRequiredCopy((items) => items.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function removeCopy(index) {
    setRequiredCopy((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section className="planning-panel review-panel" aria-labelledby="planning-title">
      <div className="planning-heading">
        <span className="eyebrow">DEEPSEEK CREATIVE PLAN</span>
        <h2 id="planning-title">检查并修改海报方案</h2>
        <p>{reasoningSummary}</p>
        <button className="analyze-button" type="button" onClick={onAnalyze} disabled={planStatus === "analyzing"}>
          {planStatus === "analyzing" ? <LoaderCircle className="spin" size={18} /> : <RefreshCcw size={18} />}
          {planStatus === "analyzing" ? "正在重新推理" : "重新推理方案"}
        </button>
      </div>
      <Sparkles className="planning-sparkle" size={42} strokeWidth={2.4} aria-hidden="true" />

      <div className="recognition-row">
        <CircleCheckBig size={22} />
        <span>已识别为 {posterType}：</span>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="内容类型">
          <option>课程推广</option><option>产品推广</option><option>观点表达</option><option>生活分享</option>
        </select>
      </div>

      <div className="plan-list editable-plan-list">
        <PlanItem icon={Target} title="画面方向">
          <textarea
            className="plan-edit-textarea"
            value={visualDirection}
            onChange={(event) => setVisualDirection(event.target.value)}
            aria-label="画面方向"
            rows={4}
          />
        </PlanItem>

        <PlanItem icon={Type} title="必须出现的文字" tone="orange">
          <div className="copy-editor-list">
            {requiredCopy.map((item, index) => (
              <div className="copy-editor-row" key={`${index}-${requiredCopy.length}`}>
                <input value={item} onChange={(event) => updateCopy(index, event.target.value)} aria-label={`海报文字 ${index + 1}`} />
                <button type="button" onClick={() => removeCopy(index)} aria-label={`删除海报文字 ${index + 1}`}><Trash2 size={17} /></button>
              </div>
            ))}
            {requiredCopy.length < 4 && (
              <button className="add-copy-button" type="button" onClick={() => setRequiredCopy((items) => [...items, ""])}>
                <Plus size={17} /> 添加一条海报文字
              </button>
            )}
          </div>
        </PlanItem>

        <PlanItem icon={QrCode} title="二维码留白" tone="lime">
          <select value={qrPosition} onChange={(event) => setQrPosition(event.target.value)} aria-label="二维码留白位置">
            <option>右下角</option><option>左下角</option><option>右侧中部</option><option>不需要留白</option>
          </select>
        </PlanItem>
      </div>

      <div className="ratio-picker" aria-label="海报比例">
        <span>输出比例</span>
        <div>
          {[
            { value: "1:1", label: "1:1" },
            { value: "3:4", label: "3:4" },
            { value: "9:16", label: "9:16" },
            { value: "16:9", label: "16:9 横屏" },
          ].map((item) => (
            <button type="button" key={item.value} className={ratio === item.value ? "is-active" : ""} onClick={() => setRatio(item.value)}>{item.label}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CreatePage({ onGenerate, error, apiConfig, onNeedSettings, activeJob, onViewJob }) {
  const [flowStep, setFlowStep] = useState(1);
  const [mode, setMode] = useState("copy");
  const [copy, setCopy] = useState(DEFAULT_COPY);
  const [category, setCategory] = useState("生活分享");
  const [ratio, setRatio] = useState("3:4");
  const [qrPosition, setQrPosition] = useState("不需要留白");
  const [posterType, setPosterType] = useState("生活类");
  const [visualDirection, setVisualDirection] = useState("");
  const [requiredCopy, setRequiredCopy] = useState([]);
  const [reasoningSummary, setReasoningSummary] = useState("");
  const [planStatus, setPlanStatus] = useState("idle");
  const [planError, setPlanError] = useState("");
  const [assets, setAssets] = useState({ person: null, product: null, logo: null });
  const [assetBusy, setAssetBusy] = useState({ person: false, product: false, logo: false });
  const [assetError, setAssetError] = useState("");
  const assetVersion = useRef({ person: 0, product: 0, logo: 0 });

  useEffect(() => {
    let active = true;
    imageApi.getSavedReferences().then((saved) => {
      if (!active) return;
      setAssets((current) => ({
        person: current.person || saved.person || null,
        product: current.product || saved.product || null,
        logo: current.logo || saved.logo || null,
      }));
    }).catch(() => {
      if (active) setAssetError("已保存的参考素材暂时无法读取，不影响继续创作。");
    });
    return () => { active = false; };
  }, []);

  async function saveAsset(role, value) {
    const previous = assets[role];
    const version = assetVersion.current[role] + 1;
    assetVersion.current[role] = version;
    setAssetError("");
    setAssets((current) => ({ ...current, [role]: value }));
    setAssetBusy((current) => ({ ...current, [role]: true }));
    try {
      const saved = await imageApi.saveReference(role, value.file);
      if (assetVersion.current[role] !== version) return;
      URL.revokeObjectURL(value.url);
      setAssets((current) => ({ ...current, [role]: saved }));
    } catch (uploadError) {
      if (assetVersion.current[role] !== version) return;
      URL.revokeObjectURL(value.url);
      setAssets((current) => ({ ...current, [role]: previous }));
      setAssetError(uploadError.message || "参考图保存失败，请重新选择。");
    } finally {
      if (assetVersion.current[role] === version) {
        setAssetBusy((current) => ({ ...current, [role]: false }));
      }
    }
  }

  async function removeAsset(role) {
    const previous = assets[role];
    assetVersion.current[role] += 1;
    setAssets((current) => ({ ...current, [role]: null }));
    setAssetBusy((current) => ({ ...current, [role]: true }));
    setAssetError("");
    if (previous?.url?.startsWith("blob:")) URL.revokeObjectURL(previous.url);
    try {
      await imageApi.removeReference(role);
    } catch (removeError) {
      setAssets((current) => ({ ...current, [role]: previous }));
      setAssetError(removeError.message || "参考图移除失败，请稍后重试。");
    } finally {
      setAssetBusy((current) => ({ ...current, [role]: false }));
    }
  }

  const remaining = 500 - copy.length;
  const assetsSaving = Object.values(assetBusy).some(Boolean);
  const hasActiveGeneration = Boolean(activeJob && activeJob.status !== "completed");
  const visibleStep = hasActiveGeneration ? 3 : flowStep;
  const request = useMemo(() => ({
    mode, copy, category, ratio, qrPosition, assets, posterType,
    requiredCopy: requiredCopy.map((item) => item.trim()).filter(Boolean),
    visualDirection,
  }), [mode, copy, category, ratio, qrPosition, assets, posterType, requiredCopy, visualDirection]);

  function markInputChanged() {
    setPlanStatus("stale");
    setPlanError("");
  }

  async function analyzeContent() {
    if (!copy.trim()) {
      setPlanError("请先输入朋友圈文案或图片要求，再进入下一步。");
      return;
    }
    if (!apiConfig?.deepseekConfigured) {
      setPlanError("请先在服务设置中配置 DeepSeek API Key。");
      onNeedSettings();
      return;
    }
    setPlanStatus("analyzing");
    setPlanError("");
    try {
      const plan = await imageApi.plan({ mode, copy });
      setCategory(plan.category); setQrPosition(plan.qrPosition); setPosterType(plan.posterType);
      setVisualDirection(plan.visualDirection); setRequiredCopy(plan.requiredCopy);
      setReasoningSummary(plan.reasoningSummary); setPlanStatus("ready"); setFlowStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (analysisError) {
      setPlanStatus("error");
      setPlanError(analysisError.message || "DeepSeek 策划失败，请重试。");
    }
  }

  function handleGenerateClick() {
    if (!apiConfig?.allConfigured) {
      onNeedSettings();
      return;
    }
    onGenerate(request);
  }

  return (
    <main className="create-page step-create-page">
      <section className="hero-copy compact-hero">
        <p className="hero-kicker"><Sparkles size={17} /> 三步生成朋友圈海报</p>
        <h1>先说你想发什么，再确认 AI 的方案</h1>
        <p>不需要会写提示词。每一步都看得懂、改得了，最后再交给 Image2 一次生成。</p>
      </section>

      <FlowSteps current={visibleStep} />

      {hasActiveGeneration && (
        <section className="background-job-banner" aria-live="polite">
          <span><LoaderCircle className="spin" size={24} /></span>
          <div><strong>海报正在后台生成</strong><p>你可以查看其他页面，任务不会中断。</p></div>
          <button type="button" onClick={onViewJob}>查看任务进度</button>
        </section>
      )}

      {!hasActiveGeneration && (flowStep === 1 ? (
        <section className="step-card input-step-card" aria-labelledby="step-one-title">
          <div className="step-card-heading">
            <span>01</span>
            <div><p>第一步</p><h2 id="step-one-title">输入你想表达的内容</h2></div>
          </div>

          <div className="mode-tabs" role="tablist" aria-label="输入方式">
            <button type="button" role="tab" aria-selected={mode === "copy"} className={mode === "copy" ? "is-active" : ""} onClick={() => { setMode("copy"); markInputChanged(); }}>
              <FileText size={20} /> 根据朋友圈文案配图
            </button>
            <button type="button" role="tab" aria-selected={mode === "prompt"} className={mode === "prompt" ? "is-active" : ""} onClick={() => { setMode("prompt"); markInputChanged(); }}>
              <WandSparkles size={20} /> 直接描述想要的图片
            </button>
          </div>

          <div className="input-surface step-input-surface">
            <label htmlFor="poster-copy">{mode === "copy" ? "朋友圈文案" : "图片生成要求"}</label>
            <div className="textarea-wrap">
              <textarea id="poster-copy" value={copy} maxLength={500} onChange={(event) => { setCopy(event.target.value); markInputChanged(); }} placeholder={mode === "copy" ? "粘贴你准备发布的朋友圈文案……" : "例如：我想要一张竖版海边生活照，人物自然地走在沙滩上……"} />
              <span className={remaining < 40 ? "is-warning" : ""}>{copy.length}/500</span>
            </div>

            <div className="optional-assets-heading"><div><h3>添加参考素材</h3><p>全部可选，不上传也可以继续。</p></div><span>可选</span></div>
            <div className="assets-grid">
              <UploadSlot label="人物参考图" value={assets.person} optional busy={assetBusy.person} onChange={(value) => saveAsset("person", value)} onRemove={() => removeAsset("person")} />
              <UploadSlot label="产品/课程封面" value={assets.product} optional busy={assetBusy.product} onChange={(value) => saveAsset("product", value)} onRemove={() => removeAsset("product")} />
              <UploadSlot label="Logo" value={assets.logo} fallback optional busy={assetBusy.logo} onChange={(value) => saveAsset("logo", value)} onRemove={() => removeAsset("logo")} />
            </div>
            <p className="upload-help"><Info size={16} /> 参考图会按当前账号保存，下次创作自动恢复；生成时会与方案一起交给 Image2。</p>
          </div>

          {assetError && <div className="inline-error step-error" role="alert"><Info size={18} /> {assetError}</div>}
          {planError && <div className="inline-error step-error" role="alert"><Info size={18} /> {planError}</div>}
          <button className="plan-next-button" type="button" onClick={analyzeContent} disabled={assetsSaving || planStatus === "analyzing" || Boolean(activeJob && activeJob.status !== "completed")}>
            {assetsSaving || planStatus === "analyzing" ? <LoaderCircle className="spin" size={22} /> : <BrainCircuit size={22} />}
            <span>{assetsSaving ? "正在保存参考图" : planStatus === "analyzing" ? "DeepSeek 正在理解内容" : "生成海报方案，进入第 2 步"}</span>
            {planStatus !== "analyzing" && <ChevronRight size={22} />}
          </button>
        </section>
      ) : (
        <section className="review-step" aria-labelledby="step-two-title">
          <div className="input-summary-bar">
            <div><span>{mode === "copy" ? "朋友圈文案" : "图片要求"}</span><p>{copy}</p></div>
            <button type="button" onClick={() => setFlowStep(1)}><ArrowLeft size={18} /> 返回修改输入</button>
          </div>
          <div className="step-card-heading review-heading">
            <span>02</span>
            <div><p>第二步</p><h2 id="step-two-title">确认方案，没有问题再生成</h2></div>
          </div>
          <PlanningPanel category={category} setCategory={setCategory} ratio={ratio} setRatio={setRatio} qrPosition={qrPosition} setQrPosition={setQrPosition} visualDirection={visualDirection} setVisualDirection={setVisualDirection} requiredCopy={requiredCopy} setRequiredCopy={setRequiredCopy} posterType={posterType} reasoningSummary={reasoningSummary} onAnalyze={analyzeContent} planStatus={planStatus} />

          {error && <div className="inline-error" role="alert"><Info size={18} /> {error}</div>}
          <button className="generate-button step-generate-button" type="button" onClick={handleGenerateClick} disabled={assetsSaving || Boolean(activeJob && activeJob.status !== "completed")}>
            <Sparkles size={26} /><span>确认方案，生成完整海报</span><span className="button-arrow" aria-hidden="true"><ChevronRight size={25} /></span>
          </button>
          <p className="generation-note"><Check size={16} /> 提交后可放到后台，去其他页面不会影响生成</p>
        </section>
      ))}
    </main>
  );
}

function GenerationDialog({ progress, status, canBackground, onBackground }) {
  const steps = [
    [25, "正在整理完整海报提示词"],
    [55, "正在上传参考图"],
    [80, "Image2 正在生成完整海报"],
    [100, "正在保存生成结果"],
  ];
  const state = jobStateMeta({ status });
  const currentStep = status === "submitting" ? "正在安全提交给 Image2" : steps.find(([threshold]) => progress <= threshold)?.[1] || steps[3][1];

  return (
    <div className="dialog-scrim" role="presentation">
      <section className="generation-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-title" aria-live="polite">
        <span className="generation-orbit" aria-hidden="true">
          <LoaderCircle size={46} />
        </span>
        <span className="eyebrow">ONE-SHOT GENERATION</span>
        <h2 id="generation-title">{state.title}</h2>
        <p>{currentStep}</p>
        <div className="progress-track" aria-label={`生成进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong>{progress}%</strong>
        <small>{canBackground ? "任务记录已经安全保存，退出后重新登录也可以继续查看。" : "正在上传素材并创建任务记录，保存完成后才可以放到后台。"}</small>
        <button type="button" onClick={onBackground} disabled={!canBackground}>
          {canBackground ? "放到后台，去做其他事情" : "正在保存任务记录…"}
        </button>
      </section>
    </div>
  );
}

function ResultPage({ onBack, onRegenerate, request, result }) {
  const imageUrl = result?.imageUrl || "/assets/generated-poster.png";
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function downloadPoster() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const downloadUrl = result?.id
        ? (await imageApi.getDownloadUrl(result.id)).downloadUrl
        : imageUrl;
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `朋友圈海报-${result?.id?.slice(0, 8) || "示例"}.png`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setDownloadError(error.message || "高清海报下载失败，请稍后重试。");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="result-page">
      <div className="result-heading">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={19} /> 返回创作
        </button>
        <div>
          <span className="success-kicker">
            <CircleCheckBig size={18} /> 已完成
          </span>
          <h1>你的完整海报已生成</h1>
          <p>画面、人物、文字和排版已由 Image2 一次生成。</p>
        </div>
      </div>

      <div className="result-layout">
        <div className="poster-stage">
          <img src={imageUrl} alt="Image2 生成的朋友圈海报" />
        </div>
        <aside className="result-sidebar">
          <section>
            <span className="eyebrow">GENERATION SUMMARY</span>
            <h2>生成信息</h2>
            <dl>
              <div>
                <dt>内容类型</dt>
                <dd>{request?.category || "课程推广"}</dd>
              </div>
              <div>
                <dt>输出比例</dt>
                <dd>{request?.ratio || "3:4"}</dd>
              </div>
              <div>
                <dt>二维码留白</dt>
                <dd>{request?.qrPosition || "右下角"}</dd>
              </div>
              <div>
                <dt>生成方式</dt>
                <dd>Image2 一次生成</dd>
              </div>
            </dl>
          </section>

          <button className="download-button" type="button" onClick={downloadPoster} disabled={downloading}>
            {downloading ? <LoaderCircle className="spin" size={21} /> : <Download size={21} />}
            {downloading ? "正在准备高清图" : "下载高清海报"}
          </button>
          {downloadError && <p className="inline-error" role="alert"><Info size={17} /> {downloadError}</p>}
          <button className="regenerate-button" type="button" onClick={onRegenerate}>
            <RefreshCcw size={19} /> 修改要求并重新生成
          </button>

          {result?.demo && (
            <p className="demo-result-note">
              <Info size={17} /> 当前展示演示结果。接入 API Key 后，这里会显示真实任务返回的图片。
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function WorksPage({
  onCreate, onOpenResult, activeJob, generatedProjects, onOpenJob,
  onDelete, onRetry, onOpenSettings, onImageError, onImageLoad,
}) {
  const projects = activeJob && activeJob.status !== "completed"
    ? generatedProjects.filter((project) => project.id !== activeJob.id)
    : generatedProjects;
  function dateLabel(value) {
    return value ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "刚刚";
  }
  return (
    <main className="works-page">
      <div className="works-heading">
        <div>
          <span className="eyebrow">作品记录</span>
          <h1>我的作品</h1>
          <p>找回历史海报，或从上次方案继续创作。</p>
        </div>
        <button className="compact-action" type="button" onClick={onCreate}>
          <Plus size={19} /> 创作新海报
        </button>
      </div>

      <div className="works-toolbar">
        <div className="works-filter" role="group" aria-label="作品筛选">
          <button className="is-active" type="button">全部作品</button>
          <button type="button">生活分享</button>
          <button type="button">观点表达</button>
          <button type="button">营销推广</button>
        </div>
      </div>

      <div className="works-grid">
        <button className="new-work-card" type="button" onClick={onCreate}>
          <span><Plus size={28} /></span>
          <strong>创作一张新海报</strong>
          <small>粘贴朋友圈文案即可开始</small>
        </button>
        {activeJob?.id && activeJob.status !== "completed" && (
          <article className="work-card active-job-card">
            <button className="work-image" type="button" onClick={onOpenJob}>
              <span className="active-job-visual"><LoaderCircle className="spin" size={38} /><strong>{activeJob.progress || 8}%</strong></span>
              <span>查看生成进度</span>
            </button>
            <div className="work-meta">
              <span className={`work-status is-${activeJob.status}`}><LoaderCircle className="spin" size={14} /> {jobStateMeta(activeJob).label}</span>
              <h2>{activeJob.request?.requiredCopy?.[0] || "正在生成新的朋友圈海报"}</h2>
              <small className="work-state-detail">{jobStateMeta(activeJob).detail}</small>
              <p><span>{activeJob.request?.category || "AI 海报"}</span><span>{activeJob.request?.ratio || "3:4"}</span><span><Clock3 size={14} /> 刚刚</span></p>
            </div>
          </article>
        )}
        {projects.map((project) => (
          <article className="work-card" key={project.id}>
            <button className="work-image" type="button" onClick={() => project.status === "completed" && onOpenResult(project)} disabled={project.status !== "completed"}>
              {project.imageUrl ? (
                <img
                  src={project.imageUrl}
                  alt={project.title}
                  onError={() => onImageError(project.id)}
                  onLoad={() => onImageLoad(project.id)}
                />
              ) : <span className={`work-placeholder is-${project.status}`}>{["failed", "delayed"].includes(project.status) ? <Info size={30} /> : <LoaderCircle className="spin" size={34} />}<strong>{jobStateMeta(project).title}</strong></span>}
              {project.status === "completed" && <span>查看结果</span>}
            </button>
            <div className="work-meta">
              <span className={`work-status is-${project.status}`}>{project.status === "completed" ? <Check size={14} /> : ["failed", "delayed"].includes(project.status) ? <Info size={14} /> : <LoaderCircle className="spin" size={14} />} {jobStateMeta(project).label}</span>
              <h2>{project.title}</h2>
              {project.status !== "completed" && <small className="work-state-detail">{jobStateMeta(project).detail}</small>}
              <p>
                <span>{project.category}</span>
                <span>{project.ratio}</span>
                <span><Clock3 size={14} /> {dateLabel(project.updatedAt)}</span>
              </p>
              {["delayed", "failed"].includes(project.status) && (
                <div className="work-recovery-actions">
                  {project.retryable && <button type="button" onClick={() => onRetry(project)}><RefreshCcw size={16} />{project.providerTaskId ? "继续查询原任务" : "安全重试"}</button>}
                  {!project.retryable && project.errorCategory === "authentication" && <button type="button" onClick={onOpenSettings}><Settings2 size={16} />检查服务设置</button>}
                  {!project.retryable && project.errorCategory === "balance" && <a href="https://openapi.yiminju.xyz/" target="_blank" rel="noreferrer"><ExternalLink size={16} />前往 Image2</a>}
                </div>
              )}
              <button className="delete-work-button" type="button" onClick={() => onDelete(project)}><Trash2 size={16} />删除作品</button>
            </div>
          </article>
        ))}
        {!activeJob && projects.length === 0 && <div className="works-empty"><ImageIcon size={34} /><strong>还没有作品</strong><p>完成第一张海报后，会自动保存在这里。</p></div>}
      </div>
    </main>
  );
}

function ProductApp({ user, access, onSignOut }) {
  const [page, setPage] = useState(pageFromLocation);
  const [error, setError] = useState("");
  const [lastRequest, setLastRequest] = useState(null);
  const [generationResult, setGenerationResult] = useState(null);
  const [apiConfig, setApiConfig] = useState({ image2Configured: false, deepseekConfigured: false, allConfigured: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [generatedProjects, setGeneratedProjects] = useState([]);
  const [toast, setToast] = useState("");
  const [creationSession, setCreationSession] = useState(0);
  const generationController = useRef(null);
  const dialogOpenRef = useRef(false);
  const restoredJobRef = useRef(false);
  const worksRefreshPromiseRef = useRef(null);
  const worksLoadedAtRef = useRef(0);
  const imageRefreshAttemptsRef = useRef(new Map());

  useEffect(() => {
    function restorePageFromUrl() {
      const restoredPage = pageFromLocation();
      setPage(restoredPage === "admin" && access?.role !== "admin" ? "create" : restoredPage);
    }
    window.addEventListener("hashchange", restorePageFromUrl);
    return () => window.removeEventListener("hashchange", restorePageFromUrl);
  }, [access?.role]);

  const loadWorks = useCallback(() => {
    if (worksRefreshPromiseRef.current) return worksRefreshPromiseRef.current;
    const request = imageApi.getWorks()
      .then((works) => {
        setGeneratedProjects(works);
        worksLoadedAtRef.current = Date.now();
        return works;
      })
      .finally(() => {
        if (worksRefreshPromiseRef.current === request) worksRefreshPromiseRef.current = null;
      });
    worksRefreshPromiseRef.current = request;
    return request;
  }, []);

  const refreshWorksIfStale = useCallback(() => {
    const fortyFiveMinutes = 45 * 60 * 1000;
    if (Date.now() - worksLoadedAtRef.current < fortyFiveMinutes) return Promise.resolve(null);
    return loadWorks();
  }, [loadWorks]);

  useEffect(() => {
    const controller = new AbortController();
    async function bootstrap() {
      imageApi.getConfig().then(setApiConfig).catch(() => setApiConfig({ image2Configured: false, deepseekConfigured: false, allConfigured: false }));
      try {
        const works = await loadWorks();
        const running = works.find((item) => ["processing", "submitting", "queued"].includes(item.status));
        if (running && !restoredJobRef.current) {
          restoredJobRef.current = true;
          const request = { ...(running.input || {}), ...(running.plan || {}), category: running.category, ratio: running.ratio };
          const task = { ...running, taskId: running.id, request };
          setActiveJob(task);
          generationController.current = controller;
          resumeGeneration(task, request, controller);
        }
      } catch (loadError) {
        setError(loadError.message || "无法读取作品记录。");
      }
    }
    bootstrap();
    return () => {
      controller.abort();
      generationController.current?.abort();
      restoredJobRef.current = false;
    };
  }, [loadWorks]);

  useEffect(() => {
    if (page !== "works") return undefined;
    loadWorks().catch(() => undefined);
    const refreshVisibleWorks = () => {
      if (document.visibilityState === "visible") refreshWorksIfStale().catch(() => undefined);
    };
    const timer = window.setInterval(refreshVisibleWorks, 45 * 60 * 1000);
    window.addEventListener("focus", refreshVisibleWorks);
    document.addEventListener("visibilitychange", refreshVisibleWorks);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleWorks);
      document.removeEventListener("visibilitychange", refreshVisibleWorks);
    };
  }, [loadWorks, page, refreshWorksIfStale]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const recordActivity = () => {
      if (document.visibilityState === "visible") {
        api("/api/activity/heartbeat", jsonInit("POST", { path: page })).catch(() => undefined);
      }
    };
    recordActivity();
    const timer = window.setInterval(recordActivity, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", recordActivity);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", recordActivity);
    };
  }, [page]);

  function setJobProgress(progress, stored) {
    setActiveJob((current) => {
      if (!current) return current;
      return { ...current, ...stored, progress, status: stored?.status || current.status };
    });
  }

  function finishGeneration(result, request, task) {
    setLastRequest(request);
    setGenerationResult(result);
    loadWorks().catch(() => undefined);
    setActiveJob({ ...task, status: "completed", progress: 100, request, result });
    if (dialogOpenRef.current) {
      dialogOpenRef.current = false;
      setGenerationDialogOpen(false);
      navigate("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setToast("海报已经生成完成，可在“我的作品”中查看。");
    }
  }

  async function resumeGeneration(task, request, controller) {
    try {
      const result = await imageApi.resume(task, { signal: controller.signal, onProgress: setJobProgress });
      finishGeneration(result, request, task);
    } catch (generationError) {
      if (generationError.name === "AbortError") return;
      setActiveJob(null);
      const latest = await loadWorks().catch(() => []);
      dialogOpenRef.current = false;
      setGenerationDialogOpen(false);
      const persisted = generationError.job || latest.find((item) => item.id === (task.id || task.taskId));
      setToast(persisted?.status === "delayed" ? "任务等待时间较长，已停止自动查询；可在作品中继续。" : generationError.message || "生成任务没有完成，请查看失败原因。");
      navigate("works");
    }
  }

  async function handleGenerate(request) {
    if (!request.copy.trim()) {
      setError("请先输入朋友圈文案或图片生成要求，再生成海报。");
      return;
    }

    setError("");
    setLastRequest(request);
    const controller = new AbortController();
    generationController.current = controller;
    const preparingJob = { taskId: `preparing-${Date.now()}`, status: "preparing", progress: 8, request, startedAt: Date.now(), persisted: false };
    setActiveJob(preparingJob);
    dialogOpenRef.current = true;
    setGenerationDialogOpen(true);

    try {
      const task = await imageApi.submit(request, {
        signal: controller.signal,
        onProgress: setJobProgress,
        onPersisted: (persistedTask) => {
          setActiveJob({ ...persistedTask, taskId: persistedTask.id, request, persisted: true });
          loadWorks().catch(() => undefined);
        },
      });
      const submittedJob = { ...task, progress: Math.max(24, task.progress || 0), request, persisted: true };
      setActiveJob(submittedJob);
      loadWorks().catch(() => undefined);
      await resumeGeneration(submittedJob, request, controller);
    } catch (generationError) {
      if (generationError.name !== "AbortError") {
        setActiveJob(null);
        dialogOpenRef.current = false;
        setGenerationDialogOpen(false);
        await loadWorks().catch(() => undefined);
        setToast(generationError.message || "生成任务没有完成，请到我的作品查看原因。");
        navigate("works");
      }
    }
  }

  async function retryProject(project) {
    setError("");
    const controller = new AbortController();
    generationController.current?.abort();
    generationController.current = controller;
    const request = { ...(project.input || {}), ...(project.plan || {}), category: project.category, ratio: project.ratio };
    try {
      const task = await imageApi.retryTask(project.id, { signal: controller.signal });
      if (task.status === "completed") {
        finishGeneration(task, request, task);
        return;
      }
      const active = { ...task, taskId: task.id, request };
      setActiveJob(active);
      setToast(task.providerTaskId ? "正在继续查询原来的 Image2 任务，不会重复扣费。" : "已使用原请求编号安全重试。" );
      await loadWorks().catch(() => undefined);
      resumeGeneration(active, request, controller);
    } catch (retryError) {
      if (retryError.name === "AbortError") return;
      setActiveJob(null);
      await loadWorks().catch(() => undefined);
      setToast(retryError.message || "暂时无法继续任务，请稍后再试。");
    }
  }

  function sendGenerationToBackground() {
    if (!activeJob?.id) {
      setToast("任务记录仍在保存，请稍等几秒再放到后台。");
      return;
    }
    dialogOpenRef.current = false;
    setGenerationDialogOpen(false);
    navigate("works");
    setToast("任务记录已保存并转到后台，退出后重新登录也能继续查看。");
  }

  function openActiveJob() {
    if (!activeJob) return;
    if (activeJob.status === "completed" && activeJob.result) {
      setLastRequest(activeJob.request);
      setGenerationResult(activeJob.result);
      navigate("result");
      return;
    }
    dialogOpenRef.current = true;
    setGenerationDialogOpen(true);
  }

  function openProject(project) {
    setLastRequest({ ...(project.input || {}), ...(project.plan || {}), category: project.category, ratio: project.ratio });
    setGenerationResult({ ...project, imageUrl: project.imageUrl });
    navigate("result");
  }

  function refreshFailedWorkImage(projectId) {
    const lastAttemptAt = imageRefreshAttemptsRef.current.get(projectId) || 0;
    if (Date.now() - lastAttemptAt < 60 * 1000) return;
    imageRefreshAttemptsRef.current.set(projectId, Date.now());
    loadWorks().catch(() => setToast("图片链接暂时无法刷新，请检查网络后重试。"));
  }

  function markWorkImageLoaded(projectId) {
    imageRefreshAttemptsRef.current.delete(projectId);
  }

  async function deleteProject(project) {
    if (!window.confirm(`确定删除“${project.title}”吗？删除后无法恢复。`)) return;
    try {
      await imageApi.deleteWork(project.id);
      setGeneratedProjects((items) => items.filter((item) => item.id !== project.id));
      setToast("作品已删除。");
    } catch (deleteError) {
      setToast(deleteError.message || "删除失败，请稍后重试。");
    }
  }

  function startNewCreation() {
    setCreationSession((value) => value + 1);
    setError("");
    navigate("create");
  }

  function navigate(nextPage) {
    const safePage = APP_PAGES.has(nextPage) ? nextPage : nextPage === "result" ? "result" : "create";
    const authorizedPage = safePage === "admin" && access?.role !== "admin" ? "create" : safePage;
    setPage(authorizedPage);
    if (authorizedPage !== "result") {
      const currentAdminRoute = window.location.hash.startsWith("#admin/");
      const hash = authorizedPage === "admin" && currentAdminRoute ? window.location.hash : `#${authorizedPage}`;
      if (window.location.hash !== hash) window.location.hash = hash;
    }
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (page === "admin" && access?.role === "admin") {
    return <AdminPage onBack={() => navigate("create")} user={user} onSignOut={onSignOut} />;
  }

  return (
    <div className="app-shell">
      <Header page={page} onNavigate={navigate} apiConfig={apiConfig} onOpenSettings={() => setSettingsOpen(true)} activeJob={activeJob} onOpenJob={openActiveJob} user={user} access={access} onSignOut={onSignOut} onOpenAdmin={() => navigate("admin")} />
      <div hidden={page !== "create"}>
        <CreatePage
          key={creationSession}
          onGenerate={handleGenerate}
          error={error}
          apiConfig={apiConfig}
          onNeedSettings={() => setSettingsOpen(true)}
          activeJob={activeJob}
          onViewJob={openActiveJob}
        />
      </div>
      {page === "works" && (
        <WorksPage
          onCreate={startNewCreation}
          onOpenResult={openProject}
          activeJob={activeJob}
          generatedProjects={generatedProjects}
          onOpenJob={openActiveJob}
          onDelete={deleteProject}
          onRetry={retryProject}
          onOpenSettings={() => setSettingsOpen(true)}
          onImageError={refreshFailedWorkImage}
          onImageLoad={markWorkImageLoaded}
        />
      )}
      {page === "tutorial" && <TutorialPage onCreate={startNewCreation} />}
      {page === "result" && (
        <ResultPage
          request={lastRequest}
          result={generationResult}
          onBack={() => navigate("create")}
          onRegenerate={() => navigate("create")}
        />
      )}
      {generationDialogOpen && activeJob && <GenerationDialog progress={activeJob.progress || 8} status={activeJob.status} canBackground={Boolean(activeJob.id)} onBackground={sendGenerationToBackground} />}
      {settingsOpen && (
        <SettingsDialog
          config={apiConfig}
          onClose={() => setSettingsOpen(false)}
          onSaved={setApiConfig}
        />
      )}
      {toast && <div className="app-toast" role="status"><CircleCheckBig size={19} /> {toast}</div>}
    </div>
  );
}

export function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessNotice, setAccessNotice] = useState("");

  const loadAccess = useCallback(async () => {
    if (!user) return null;
    setAccessLoading(true);
    try {
      let state = await api("/api/access/status");
      const pendingCode = window.sessionStorage.getItem("poster.pending-invite");
      if (pendingCode && !state.activated) {
        try {
          state = await api("/api/access/redeem", jsonInit("POST", { code: pendingCode }));
          setAccessNotice("暗号验证成功，这个账号已免年费。");
        } catch (redeemError) {
          setAccessNotice(`账号已注册，但暗号未激活：${redeemError.message}`);
        } finally {
          window.sessionStorage.removeItem("poster.pending-invite");
        }
      }
      setAccess(state);
      return state;
    } catch (loadError) {
      setAccessNotice(loadError.message || "无法读取账号状态，请稍后重试。");
      setAccess(null);
      return null;
    } finally {
      setAccessLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setAccess(null);
      setAccessLoading(false);
      return;
    }
    loadAccess();
  }, [user?.id, loadAccess]);

  async function handleSignOut() {
    await signOut();
    setAccess(null);
    setAccessNotice("");
  }

  if (authLoading || (user && accessLoading)) {
    return <main className="app-loading"><span><WandSparkles size={28} /></span><LoaderCircle className="spin" size={30} /><p>正在打开你的创作空间</p></main>;
  }
  if (!user) return <AuthPage />;
  if (!access?.activated) return <AccessPage user={user} notice={accessNotice} onActivated={loadAccess} onSignOut={handleSignOut} />;
  return <ProductApp user={user} access={access} onSignOut={handleSignOut} />;
}
