# 客户源码包清单

## 包含

- `server/src`、`server/drizzle`、服务端配置与锁文件；
- `web/src`、运行所需公共素材、前端配置与锁文件；
- `configs/auth-config.customer.yaml` 客户注册规则备份；
- `design-system` 和 `visual-directions`，供客户 Agent 延续既有 UI；
- `AGENTS.md`、`AGENT_DEPLOY.md`、`CUSTOMER_CONFIGURATION.md`；
- 无项目 ID 的 `edgespark.toml` 模板。

## 明确排除

- `.env*`、`.edgespark`、`.git`、`node_modules`、`dist`、日志和缓存；
- 当前生产 `edgespark.toml`、`DEPLOYMENT.md` 和生产域名信息；
- 本地 seed 数据、用户数据、数据库文件、作品与上传文件；
- 微信域名验证 TXT、支付证书、OSS 配置包和教学视频；
- 旧版 `webapp`、旧版 `wechat-poster-agent`、历史压缩包和设计验收截图。

包内 `edgespark.toml` 没有 `project_id` 是预期行为。必须使用 `edgespark init --template` 创建客户自己的新项目，由 EdgeSpark 写入新项目 ID。
