import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CircleDashed,
  CircleDollarSign,
  Clipboard,
  FileImage,
  Gauge,
  Eye,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";
import { api, jsonInit } from "../lib/api";
import { FailureBars, FunnelBars, OperationsTrendChart } from "../components/admin/AdminCharts.jsx";
import { TutorialManager } from "../components/admin/TutorialManager.jsx";

const NAV_ITEMS = [
  { id: "overview", label: "运营总览", icon: LayoutDashboard },
  { id: "users", label: "用户管理", icon: Users },
  { id: "jobs", label: "生成记录", icon: FileImage },
  { id: "tutorial", label: "新手教学", icon: BookOpenCheck },
  { id: "invites", label: "暗号管理", icon: KeyRound },
];
const ADMIN_TABS = new Set(NAV_ITEMS.map((item) => item.id));

function tabFromLocation() {
  const [section, tab] = window.location.hash.replace(/^#\/?/u, "").split("/");
  return section === "admin" && ADMIN_TABS.has(tab) ? tab : "overview";
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)) : "—";
}

function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

function formatDuration(value) {
  if (!value) return "—";
  const seconds = Math.round(value / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function statusLabel(status) {
  return {
    active: "已开通",
    expired: "已过期",
    revoked: "已撤销",
    pending: "未开通",
    queued: "排队中",
    submitting: "提交中",
    processing: "生成中",
    delayed: "待继续",
    completed: "已成功",
    failed: "已失败",
    disabled: "已停用",
  }[status] || status;
}

function StatusPill({ status, children }) {
  return <span className={`admin-status is-${status}`}>{children || statusLabel(status)}</span>;
}

function ProviderStatus({ label, connected }) {
  return (
    <span className={`admin-provider-state ${connected ? "is-connected" : "is-missing"}`} aria-label={`${label}${connected ? "已配置" : "未配置"}`}>
      {connected ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
      <strong>{label}</strong>
      <small>{connected ? "已配置" : "未配置"}</small>
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, detail, change, tone = "brand" }) {
  const hasChange = typeof change === "number";
  return (
    <article className={`admin-metric-card is-${tone}`}>
      <span className="admin-metric-icon"><Icon size={20} /></span>
      <div><span>{label}</span><strong>{value}</strong></div>
      <p>{hasChange ? <span className={change >= 0 ? "is-up" : "is-down"}>{change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{Math.abs(change)}%</span> : null}{detail}</p>
    </article>
  );
}

function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label="分页">
      <button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>上一页</button>
      <span>第 {pagination.page} / {pagination.totalPages} 页，共 {pagination.total} 条</span>
      <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>下一页</button>
    </nav>
  );
}

function LoadingState() {
  return <div className="admin-loading"><LoaderCircle className="spin" size={24} />正在读取运营数据</div>;
}

function EmptyState({ children }) {
  return <div className="admin-empty"><FileImage size={28} /><strong>{children}</strong><span>调整筛选条件后再试一次。</span></div>;
}

function JobImagePreview({ job, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="dialog-scrim admin-image-preview-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-image-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-image-preview-title">
        <header>
          <div>
            <span>生成结果大图</span>
            <h2 id="admin-image-preview-title">{job.title}</h2>
            <p>{job.posterType} · {job.category} · {job.ratio}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭大图预览"><X size={22} /></button>
        </header>
        <figure>
          <img src={job.imageUrl} alt={`${job.title}生成结果大图`} />
        </figure>
      </section>
    </div>
  );
}

export function AdminPage({ onBack, user, onSignOut }) {
  const [activeTab, setActiveTab] = useState(tabFromLocation);
  const [menuOpen, setMenuOpen] = useState(false);
  const [days, setDays] = useState(14);
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [invites, setInvites] = useState(null);
  const [tutorials, setTutorials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userFilters, setUserFilters] = useState({ query: "", access: "all", provider: "all", page: 1 });
  const [jobSearch, setJobSearch] = useState("");
  const [jobFilters, setJobFilters] = useState({ query: "", status: "all", posterType: "all", category: "all", page: 1 });
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [previewJob, setPreviewJob] = useState(null);

  const loadActive = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "overview") {
        setOverview(await api(`/api/admin/overview?days=${days}`));
      } else if (activeTab === "users") {
        const params = new URLSearchParams({ ...userFilters, page: String(userFilters.page), pageSize: "20" });
        setUsers(await api(`/api/admin/users?${params}`));
      } else if (activeTab === "jobs") {
        const params = new URLSearchParams({ ...jobFilters, page: String(jobFilters.page), pageSize: "20" });
        setJobs(await api(`/api/admin/jobs?${params}`));
      } else if (activeTab === "tutorial") {
        setTutorials(await api("/api/admin/tutorials"));
      } else {
        setInvites(await api("/api/admin/invite-codes"));
      }
    } catch (loadError) {
      setError(loadError.message || "运营数据读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [activeTab, days, jobFilters, refreshKey, userFilters]);

  useEffect(() => { loadActive(); }, [loadActive]);

  useEffect(() => {
    function restoreAdminTab() {
      setActiveTab(tabFromLocation());
      setMenuOpen(false);
    }
    window.addEventListener("hashchange", restoreAdminTab);
    return () => window.removeEventListener("hashchange", restoreAdminTab);
  }, []);

  function navigate(tab) {
    setActiveTab(tab);
    const hash = `#admin/${tab}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setMenuOpen(false);
    setError("");
  }

  async function updateAccess(target, action) {
    if (action === "revoke" && !window.confirm(`确定撤销 ${target.email} 的使用权限吗？`)) return;
    setError("");
    try {
      await api(`/api/admin/users/${target.id}/access`, jsonInit("PATCH", { action }));
      setRefreshKey((value) => value + 1);
    } catch (updateError) { setError(updateError.message); }
  }

  async function createCode(event) {
    event.preventDefault();
    setCreating(true); setError(""); setNewCode("");
    try {
      const result = await api("/api/admin/invite-codes", jsonInit("POST", { label, maxUses: Number(maxUses) }));
      setNewCode(result.code); setLabel(""); setMaxUses(1); setRefreshKey((value) => value + 1);
    } catch (createError) { setError(createError.message); }
    finally { setCreating(false); }
  }

  async function toggleInvite(invite) {
    try {
      await api(`/api/admin/invite-codes/${invite.id}`, jsonInit("PATCH", { status: invite.status === "active" ? "disabled" : "active" }));
      setRefreshKey((value) => value + 1);
    } catch (toggleError) { setError(toggleError.message); }
  }

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) || NAV_ITEMS[0];

  return (
    <main className="admin-page">
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="admin-brand"><span><WandSparkles size={23} /></span><div><strong>朋友圈海报智能体</strong><small>运营管理中心</small></div></div>
        <nav className="admin-nav" aria-label="管理后台导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={activeTab === item.id ? "is-active" : ""} aria-current={activeTab === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon size={19} />{item.label}</button>;
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <button type="button" onClick={onBack}><ArrowLeft size={18} />返回创作页</button>
          <div><span>{(user?.name || user?.email || "管").slice(0, 1)}</span><p><strong>{user?.name || "管理员"}</strong><small>{user?.email}</small></p><button type="button" aria-label="退出登录" onClick={onSignOut}><LogOut size={17} /></button></div>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar">
          <button className="admin-menu-toggle" type="button" aria-label={menuOpen ? "关闭导航" : "打开导航"} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div><span className="eyebrow">OPERATIONS</span><h1>{activeNav.label}</h1><p>{activeTab === "overview" ? `按北京时间统计 · ${overview ? `更新于 ${formatDate(overview.generatedAt)}` : "正在更新"}` : "实时数据与运营操作"}</p></div>
          <button className="admin-refresh" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCcw className={loading ? "spin" : ""} size={18} /><span>刷新</span></button>
        </header>

        {error && <p className="admin-error" role="alert"><AlertTriangle size={18} />{error}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></p>}
        {loading && !({ overview, users, jobs, invites, tutorial: tutorials }[activeTab]) ? <LoadingState /> : null}

        {activeTab === "overview" && overview && (
          <div className="admin-content">
            <div className="admin-toolbar is-overview"><div><strong>今日经营快照</strong><span>数据均以北京时间自然日计算</span></div><div className="admin-range" role="group" aria-label="趋势时间范围">{[7, 14, 30].map((value) => <button type="button" key={value} className={days === value ? "is-active" : ""} onClick={() => setDays(value)}>{value} 天</button>)}</div></div>
            <section className="admin-metrics" aria-label="今日核心指标">
              <MetricCard icon={Activity} label="今日活跃用户" value={overview.metrics.dauToday} change={overview.metrics.dauChange} detail="较昨日" tone="brand" />
              <MetricCard icon={UserCheck} label="今日新增用户" value={overview.metrics.newUsersToday} change={overview.metrics.newUsersChange} detail={`累计 ${overview.metrics.totalUsers} 人`} tone="orange" />
              <MetricCard icon={FileImage} label="今日生成次数" value={overview.metrics.generationsToday} change={overview.metrics.generationsChange} detail="较昨日" tone="violet" />
              <MetricCard icon={CheckCircle2} label="今日成功率" value={`${overview.metrics.successRateToday}%`} change={overview.metrics.successRateChange} detail="已结束任务" tone="success" />
              <MetricCard icon={ShieldCheck} label="有效开通用户" value={overview.metrics.activeAccess} detail={`占注册 ${overview.metrics.totalUsers ? Math.round((overview.metrics.activeAccess / overview.metrics.totalUsers) * 100) : 0}%`} tone="brand" />
              <MetricCard icon={CircleDollarSign} label="今日年费收入" value={formatMoney(overview.metrics.revenueTodayFen)} detail={`累计 ${formatMoney(overview.metrics.revenueTotalFen)}`} tone="lime" />
            </section>

            <div className="admin-dashboard-grid is-wide-left">
              <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon"><BarChart3 size={18} /></span><div><h2>用户与生成趋势</h2><p>日活、新增用户和生成次数</p></div></div><span>近 {overview.days} 天</span></div><OperationsTrendChart data={overview.trend} /></section>
              <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon is-lime"><Gauge size={18} /></span><div><h2>用户转化漏斗</h2><p>从注册到完成首次生成</p></div></div></div><FunnelBars items={overview.funnel} /></section>
            </div>

            <div className="admin-dashboard-grid">
              <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon is-orange"><AlertTriangle size={18} /></span><div><h2>失败原因分布</h2><p>最近 30 天，仅展示脱敏分类</p></div></div></div><FailureBars items={overview.failures} /></section>
              <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon is-lime"><Activity size={18} /></span><div><h2>任务健康度</h2><p>及时发现积压、延迟和异常任务</p></div></div></div><div className="admin-health-grid"><div><span>提交中</span><strong>{overview.health.submitting}</strong></div><div><span>生成中</span><strong>{overview.health.processing}</strong></div><div className={overview.health.delayed ? "is-warning" : ""}><span>待继续</span><strong>{overview.health.delayed}</strong></div><div className={overview.health.failedToday ? "is-warning" : ""}><span>今日失败</span><strong>{overview.health.failedToday}</strong></div><div className={overview.health.stalled ? "is-danger" : ""}><span>异常停留</span><strong>{overview.health.stalled}</strong></div></div></section>
            </div>

            <section className="admin-panel admin-recent-failures"><div className="admin-panel-heading"><div><span className="admin-panel-icon is-danger"><XCircle size={18} /></span><div><h2>最近失败任务</h2><p>用于快速定位是用户配置、内容还是服务问题</p></div></div><button type="button" onClick={() => navigate("jobs")}>查看全部</button></div>{overview.recentFailures.length ? <div className="admin-table-wrap"><table><thead><tr><th>任务</th><th>用户</th><th>失败分类</th><th>失败时间</th></tr></thead><tbody>{overview.recentFailures.map((job) => <tr key={job.id}><td><strong>{job.title}</strong><small>{job.category} · {job.ratio}</small></td><td>{job.user.name || "未命名"}<small>{job.user.email}</small></td><td><StatusPill status="failed">{job.errorCategory}</StatusPill><small>{job.errorMessage}</small></td><td>{formatDate(job.updatedAt)}</td></tr>)}</tbody></table></div> : <div className="admin-empty-compact">还没有失败任务。</div>}</section>
          </div>
        )}

        {activeTab === "users" && users && (
          <div className="admin-content">
            <form className="admin-toolbar admin-filterbar" onSubmit={(event) => { event.preventDefault(); setUserFilters((current) => ({ ...current, query: userSearch.trim(), page: 1 })); }}>
              <label className="admin-search"><span className="visually-hidden">搜索用户</span><Search size={18} /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索姓名或邮箱" /></label>
              <label><span>开通状态</span><select value={userFilters.access} onChange={(event) => setUserFilters((current) => ({ ...current, access: event.target.value, page: 1 }))}><option value="all">全部</option><option value="active">已开通</option><option value="inactive">未开通 / 已过期</option></select></label>
              <label><span>API 服务</span><select value={userFilters.provider} onChange={(event) => setUserFilters((current) => ({ ...current, provider: event.target.value, page: 1 }))}><option value="all">全部</option><option value="deepseek">DeepSeek 已配置</option><option value="image2">Image2 已配置</option></select></label>
              <button type="submit"><Search size={17} />查询</button>
            </form>
            <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon"><Users size={18} /></span><div><h2>用户列表</h2><p>共 {users.pagination.total} 个账号，授权和服务配置一目了然</p></div></div></div>{users.items.length ? <div className="admin-table-wrap"><table className="admin-users-table"><thead><tr><th>用户</th><th>使用权限</th><th>API 服务</th><th>作品</th><th>最后活跃</th><th>注册时间</th><th>操作</th></tr></thead><tbody>{users.items.map((item) => <tr key={item.id}><td><strong>{item.displayName || item.name || "未命名"}</strong><small>{item.email}</small>{item.role === "admin" && <StatusPill status="admin">管理员</StatusPill>}</td><td><StatusPill status={item.accessStatus}>{statusLabel(item.accessStatus)}</StatusPill><small>{item.accessSource === "invite_code" ? "暗号免年费" : item.accessSource === "wechat_pay" ? "微信年费" : item.accessSource === "admin" ? "后台开通" : "尚未开通"}</small></td><td><div className="admin-provider-list"><ProviderStatus label="DeepSeek" connected={item.providers.includes("deepseek")} /><ProviderStatus label="Image2" connected={item.providers.includes("image2")} /></div></td><td><strong>{item.works.total}</strong><small>成功 {item.works.completed}</small></td><td>{formatDate(item.lastActiveAt)}</td><td>{formatDate(item.createdAt)}</td><td>{item.role === "admin" ? "—" : <button className={item.accessStatus === "active" ? "is-danger" : ""} type="button" onClick={() => updateAccess(item, item.accessStatus === "active" ? "revoke" : "grant")}>{item.accessStatus === "active" ? "撤销权限" : "开通一年"}</button>}</td></tr>)}</tbody></table></div> : <EmptyState>没有找到符合条件的用户</EmptyState>}<Pagination pagination={users.pagination} onPage={(page) => setUserFilters((current) => ({ ...current, page }))} /></section>
          </div>
        )}

        {activeTab === "jobs" && jobs && (
          <div className="admin-content">
            <form className="admin-toolbar admin-filterbar is-jobs" onSubmit={(event) => { event.preventDefault(); setJobFilters((current) => ({ ...current, query: jobSearch.trim(), page: 1 })); }}>
              <label className="admin-search"><span className="visually-hidden">搜索生成任务</span><Search size={18} /><input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="标题、用户或任务号" /></label>
              <label><span>任务状态</span><select value={jobFilters.status} onChange={(event) => setJobFilters((current) => ({ ...current, status: event.target.value, page: 1 }))}><option value="all">全部</option><option value="queued">排队中</option><option value="submitting">提交中</option><option value="processing">生成中</option><option value="delayed">待继续</option><option value="completed">已成功</option><option value="failed">已失败</option></select></label>
              <label><span>海报类型</span><select value={jobFilters.posterType} onChange={(event) => setJobFilters((current) => ({ ...current, posterType: event.target.value, page: 1 }))}><option value="all">全部</option><option value="生活类">生活类</option><option value="营销类">营销类</option></select></label>
              <label><span>内容场景</span><select value={jobFilters.category} onChange={(event) => setJobFilters((current) => ({ ...current, category: event.target.value, page: 1 }))}><option value="all">全部</option><option value="生活分享">生活分享</option><option value="观点表达">观点表达</option><option value="课程推广">课程推广</option><option value="产品推广">产品推广</option></select></label>
              <button type="submit"><Search size={17} />查询</button>
            </form>
            <section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-panel-icon"><FileImage size={18} /></span><div><h2>生成任务</h2><p>共 {jobs.pagination.total} 条，不展示用户原文案或参考图地址</p></div></div></div>{jobs.items.length ? <div className="admin-table-wrap"><table className="admin-jobs-table"><thead><tr><th>任务</th><th>用户</th><th>类型</th><th>状态</th><th>耗时</th><th>创建时间</th><th>结果 / 原因</th></tr></thead><tbody>{jobs.items.map((job) => <tr key={job.id}><td><div className="admin-job-title">{job.imageUrl ? <button className="admin-job-thumbnail" type="button" onClick={() => setPreviewJob(job)} aria-label={`查看${job.title}的大图`}><img src={job.imageUrl} alt={`${job.title}缩略图`} loading="lazy" /><span><Eye size={14} />查看</span></button> : <span className="admin-job-placeholder"><FileImage size={20} /></span>}<div><strong>{job.title}</strong><small>{job.id.slice(0, 8)} · {job.ratio}</small></div></div></td><td>{job.user.name || "未命名"}<small>{job.user.email}</small></td><td>{job.posterType}<small>{job.category}</small></td><td><StatusPill status={job.status} /><small>{["queued", "submitting", "processing"].includes(job.status) ? `进度 ${job.progress}%` : formatDate(job.completedAt || job.updatedAt)}</small></td><td>{formatDuration(job.durationMs)}</td><td>{formatDate(job.createdAt)}</td><td>{["failed", "delayed"].includes(job.status) ? <><strong className="admin-error-category">{job.errorCategory}</strong><small>{job.errorMessage}</small></> : job.status === "completed" ? <span className="admin-result-ok"><CheckCircle2 size={16} />已保存</span> : "等待结果"}</td></tr>)}</tbody></table></div> : <EmptyState>没有找到符合条件的生成记录</EmptyState>}<Pagination pagination={jobs.pagination} onPage={(page) => setJobFilters((current) => ({ ...current, page }))} /></section>
          </div>
        )}

        {activeTab === "tutorial" && tutorials && (
          <TutorialManager data={tutorials} onChange={setTutorials} />
        )}

        {activeTab === "invites" && invites && (
          <div className="admin-content">
            <section className="admin-panel admin-invites"><div className="admin-panel-heading"><div><span className="admin-panel-icon is-orange"><KeyRound size={18} /></span><div><h2>生成免年费暗号</h2><p>暗号明文只在创建成功时出现一次，请立即复制</p></div></div></div><form className="invite-form" onSubmit={createCode}><label><span>用途备注</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：8 月内测用户" required minLength={2} maxLength={80} /></label><label><span>可用次数</span><input type="number" min="1" max="10000" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /></label><button type="submit" disabled={creating}>{creating ? <LoaderCircle className="spin" size={19} /> : <KeyRound size={19} />}生成暗号</button></form>{newCode && <div className="new-invite-code" role="status"><span>刚生成的暗号</span><strong>{newCode}</strong><button type="button" onClick={() => navigator.clipboard.writeText(newCode)}><Clipboard size={18} />复制</button></div>}<div className="admin-table-wrap"><table><thead><tr><th>备注</th><th>使用进度</th><th>状态</th><th>过期时间</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{invites.items.map((invite) => <tr key={invite.id}><td><strong>{invite.label}</strong></td><td><div className="admin-usage-progress"><span><i style={{ width: `${Math.min(100, (invite.usedCount / invite.maxUses) * 100)}%` }} /></span><small>{invite.usedCount} / {invite.maxUses}</small></div></td><td><StatusPill status={invite.status}>{invite.status === "active" ? "可用" : "已停用"}</StatusPill></td><td>{formatDate(invite.expiresAt)}</td><td>{formatDate(invite.createdAt)}</td><td><button type="button" onClick={() => toggleInvite(invite)}>{invite.status === "active" ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div></section>
          </div>
        )}
      </section>
      {previewJob && <JobImagePreview job={previewJob} onClose={() => setPreviewJob(null)} />}
    </main>
  );
}
