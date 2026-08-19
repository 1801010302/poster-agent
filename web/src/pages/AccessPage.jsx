import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, LogOut, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, jsonInit } from "../lib/api";

export function AccessPage({ user, notice, onActivated, onSignOut }) {
  const [plan, setPlan] = useState({ amountFen: 80000, paymentConfigured: false });
  const [code, setCode] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState("");
  const [message, setMessage] = useState(notice || "");
  const [error, setError] = useState("");

  useEffect(() => { api("/api/public/billing/plan").then(setPlan).catch(() => undefined); }, []);
  useEffect(() => {
    if (!order || order.status !== "pending") return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await api(`/api/billing/orders/${order.id}`);
        setOrder(result.order);
        if (result.order.status === "paid") {
          window.clearInterval(timer);
          setMessage("支付成功，年费会员已开通。");
          onActivated();
        }
      } catch { /* 下一轮继续查询 */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status, onActivated]);

  async function redeem(event) {
    event.preventDefault();
    if (!code.trim()) return setError("请输入完整暗号。");
    setLoading("code"); setError(""); setMessage("");
    try {
      await api("/api/access/redeem", jsonInit("POST", { code }));
      setMessage("暗号验证成功，这个账号已免年费。");
      onActivated();
    } catch (redeemError) { setError(redeemError.message); }
    finally { setLoading(""); }
  }

  async function checkout() {
    setLoading("pay"); setError(""); setMessage("");
    try {
      const result = await api("/api/billing/checkout", jsonInit("POST", {}));
      setOrder(result.order);
    } catch (checkoutError) { setError(checkoutError.message); }
    finally { setLoading(""); }
  }

  return (
    <main className="access-page">
      <header className="access-header"><div className="auth-brand"><span><WandSparkles size={24} /></span>朋友圈海报智能体</div><button type="button" onClick={onSignOut}><LogOut size={17} />退出账号</button></header>
      <section className="access-intro"><p><Sparkles size={17} /> 账号已注册：{user.email}</p><h1>选择一种方式，开启你的创作空间</h1><p>有暗号直接免年费；没有暗号，支付 800 元可使用一年。两个 API Key 由你自己配置，平台不加收生图费用。</p></section>
      <div className="access-options">
        <section className="access-code-panel">
          <span className="access-icon"><KeyRound size={24} /></span><h2>我有暗号</h2><p>管理员生成的暗号可直接激活账号，不需要支付年费。</p>
          <form onSubmit={redeem}><label htmlFor="access-code">输入暗号</label><input id="access-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="HAIBAO-XXXX-XXXX" /><button type="submit" disabled={loading === "code"}>{loading === "code" ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}验证并激活</button></form>
        </section>
        <section className="access-pay-panel">
          <span className="access-icon"><ShieldCheck size={24} /></span><div className="access-price"><strong>¥{(plan.amountFen / 100).toFixed(0)}</strong><span>/ 年</span></div><h2>年费会员</h2><ul><li><Check size={17} />个人作品云端保存</li><li><Check size={17} />生成任务可在后台继续</li><li><Check size={17} />每位用户独立加密 API Key</li></ul>
          {order?.codeUrl ? <div className="payment-qr"><QRCodeSVG value={order.codeUrl} size={184} level="M" /><p>请使用微信扫码支付，页面会自动确认结果。</p></div> : <button className="access-pay-button" type="button" onClick={checkout} disabled={loading === "pay" || !plan.paymentConfigured}>{loading === "pay" ? <><LoaderCircle className="spin" size={20} />正在创建订单</> : plan.paymentConfigured ? "微信支付 ¥800 开通" : "支付通道正在配置"}</button>}
        </section>
      </div>
      {message && <p className="access-message is-success" role="status">{message}</p>}
      {error && <p className="access-message is-error" role="alert">{error}</p>}
    </main>
  );
}
