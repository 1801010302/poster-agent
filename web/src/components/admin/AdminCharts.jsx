function compactDay(day) {
  return day ? day.slice(5).replace("-", "/") : "";
}

function linePath(data, key, width, height, inset, maximum) {
  if (!data.length) return "";
  return data.map((item, index) => {
    const x = inset + (index * (width - inset * 2)) / Math.max(1, data.length - 1);
    const y = height - inset - (Number(item[key] || 0) / maximum) * (height - inset * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function OperationsTrendChart({ data }) {
  const width = 760;
  const height = 260;
  const inset = 34;
  const maximum = Math.max(1, ...data.flatMap((item) => [item.dau, item.generations, item.newUsers]));
  const labelStep = Math.max(1, Math.ceil(data.length / 7));
  const summary = data.length
    ? `最近${data.length}天，日活最高 ${Math.max(...data.map((item) => item.dau))} 人，单日生成最高 ${Math.max(...data.map((item) => item.generations))} 次。`
    : "暂时没有趋势数据。";

  return (
    <figure className="admin-chart" aria-label={summary}>
      <div className="admin-chart-legend" aria-hidden="true">
        <span className="is-dau">日活用户</span>
        <span className="is-generation">生成次数</span>
        <span className="is-new">新增用户</span>
      </div>
      {data.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = inset + ratio * (height - inset * 2);
            return <line className="chart-grid-line" key={ratio} x1={inset} x2={width - inset} y1={y} y2={y} />;
          })}
          <path className="chart-line is-dau" d={linePath(data, "dau", width, height, inset, maximum)} />
          <path className="chart-line is-generation" d={linePath(data, "generations", width, height, inset, maximum)} />
          <path className="chart-line is-new" d={linePath(data, "newUsers", width, height, inset, maximum)} />
          {data.map((item, index) => {
            if (index % labelStep !== 0 && index !== data.length - 1) return null;
            const x = inset + (index * (width - inset * 2)) / Math.max(1, data.length - 1);
            return <text className="chart-axis-label" key={item.day} x={x} y={height - 7} textAnchor="middle">{compactDay(item.day)}</text>;
          })}
        </svg>
      ) : <div className="admin-chart-empty">有用户开始使用后，这里会显示运营趋势。</div>}
      <table className="visually-hidden">
        <caption>{summary}</caption>
        <thead><tr><th>日期</th><th>日活用户</th><th>生成次数</th><th>新增用户</th></tr></thead>
        <tbody>{data.map((item) => <tr key={item.day}><td>{item.day}</td><td>{item.dau}</td><td>{item.generations}</td><td>{item.newUsers}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function FunnelBars({ items }) {
  const maximum = Math.max(1, Number(items[0]?.value || 0));
  return (
    <div className="admin-funnel" aria-label="用户转化漏斗">
      {items.map((item, index) => {
        const previous = Number(items[index - 1]?.value || maximum);
        const conversion = index === 0 ? 100 : previous ? Math.round((Number(item.value || 0) / previous) * 100) : 0;
        return (
          <div className="admin-funnel-row" key={item.key}>
            <div><span>{item.label}</span><strong>{Number(item.value || 0).toLocaleString("zh-CN")}</strong></div>
            <div className="admin-funnel-track"><span style={{ width: `${Math.max(3, (Number(item.value || 0) / maximum) * 100)}%` }} /></div>
            <small>{index === 0 ? "基准" : `上一步转化 ${conversion}%`}</small>
          </div>
        );
      })}
    </div>
  );
}

export function FailureBars({ items }) {
  const maximum = Math.max(1, ...items.map((item) => Number(item.count || 0)));
  if (!items.length) return <div className="admin-empty-compact">最近 30 天没有失败记录。</div>;
  return (
    <div className="admin-failure-bars" aria-label="最近 30 天失败原因分布">
      {items.map((item) => (
        <div className="admin-failure-row" key={item.key}>
          <div><span>{item.label}</span><strong>{item.count}</strong></div>
          <div><span style={{ width: `${Math.max(4, (Number(item.count || 0) / maximum) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
