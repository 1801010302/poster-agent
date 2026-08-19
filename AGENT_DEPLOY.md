# 给客户 Agent 的部署执行说明

你接手的是“朋友圈海报智能体”的脱敏源码模板。目标是在客户自己的 EdgeSpark 账号下创建一个全新的项目、配置客户自己的资源并完成可用性验收。

## 0. 强制安全规则

1. 不要复用、猜测或询问交付方的项目 ID、域名、数据库、用户数据、Key、支付资料或 OSS 资料。
2. 不要要求客户把任何密钥粘贴到聊天、Agent 提示词、源码、`.env`、命令行参数或日志中。
3. 对所有 EdgeSpark Secret，必须由你运行 `edgespark secret set ...`，把返回的安全填写 URL 交给客户本人打开填写。
4. 不要把 `edgespark.toml` 中的新 `project_id` 改成旧项目 ID；不要上传本机其他项目的 `.env.local`。
5. EdgeSpark 命令必须串行运行；不确定参数时先运行对应的 `--help`。
6. 微信支付和 OSS 都是可选集成。缺少客户自己的资料时保持关闭，不要填占位密钥，不要拿别人的资料代替。

## 1. 环境要求

- macOS、Linux 或 Windows WSL；
- Node.js 22 或更高版本；
- npm、Git、OpenSSL；
- 可访问 EdgeSpark、DeepSeek、Image2 及客户选择的支付/OSS 服务。

先确认：

```bash
node --version
npm --version
npx -y @edgespark/cli --version
```

## 2. 从脱敏模板创建全新 EdgeSpark 项目

本源码包根目录的 `edgespark.toml` 故意没有 `project_id`。不要在这个模板目录里直接部署。

在模板目录的上一级执行：

```bash
npx -y @edgespark/cli login
npx -y @edgespark/cli init wechat-poster-agent --agent codex --template ./朋友圈海报智能体-客户源码
```

如果 `login` 返回浏览器 URL，把 URL 给客户打开授权，然后重新执行 `init`。若解压目录名称不同，替换 `--template` 后的路径；目标项目名也可以改，但只能使用字母、数字、连字符或下划线。

`init` 成功后必须确认：

```bash
cd wechat-poster-agent
npx -y @edgespark/cli project show
```

确认 `edgespark.toml` 已由 EdgeSpark 写入一个新 `project_id`。不得继续操作没有新项目 ID 的模板目录。

## 3. 恢复本项目要求的注册配置

`edgespark init` 会从新项目拉取平台默认认证配置，可能覆盖模板中的 `configs/auth-config.yaml`。本包额外保留了客户版配置，必须复制回来再应用：

```bash
cp configs/auth-config.customer.yaml configs/auth-config.yaml
npx -y @edgespark/cli auth apply
```

客户版默认规则：允许邮箱密码注册、最短密码 8 位、不要求邮箱验证、不要求密码重置邮件验证、关闭 Google 登录。认证配置在下一次部署后生效。

## 4. 安装依赖并验证源码

```bash
cd server
npm ci
npm run typecheck
npm audit --omit=dev

cd ../web
npm ci
npm run lint
npm run build
npm audit --omit=dev

cd ..
npx -y @edgespark/cli db check
```

任何一项失败都先修复，不要带着失败结果部署。

## 5. 初始化数据库和存储

项目带有完整的、向前兼容的迁移文件和 `poster-assets` 存储桶定义：

```bash
npx -y @edgespark/cli db migrate
npx -y @edgespark/cli storage apply
```

不得用 `db sql` 手工执行 DDL，不得删除迁移，不得使用危险参数绕过检查。

## 6. 配置基础变量

先阅读 `CUSTOMER_CONFIGURATION.md`。至少向客户确认首位管理员邮箱，然后执行：

```bash
npx -y @edgespark/cli var set \
  ADMIN_BOOTSTRAP_EMAIL=客户管理员邮箱 \
  DEEPSEEK_API_BASE=https://api.deepseek.com \
  IMAGE2_API_BASE=https://openapi.yiminju.xyz/api/public/v1 \
  WECHAT_PAY_ENABLED=false \
  WECHAT_PAY_API_BASE=https://api.mch.weixin.qq.com \
  WECHAT_PAY_ORDER_EXPIRE_MINUTES=30 \
  WECHAT_PAY_CURRENCY=CNY
```

`ADMIN_BOOTSTRAP_EMAIL` 是普通变量，不是密码。该邮箱在新站注册并首次读取账号状态后会成为管理员。必须使用客户自己的邮箱。

## 7. 配置两个必需的加密密钥

在本地生成两个不同的 32 字节随机值。不要打印到聊天，不要替客户保存：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

然后由你登记密钥名称：

```bash
npx -y @edgespark/cli secret set USER_CREDENTIAL_MASTER_KEY INVITE_CODE_HMAC_KEY
```

把 CLI 返回的安全填写 URL 给客户本人。让客户把两个随机值分别填入对应字段并提交。你只能确认“是否已配置”，不能读取或复述密钥值。

重要：

- `USER_CREDENTIAL_MASTER_KEY` 用来加密每位用户填写的 DeepSeek / Image2 Key；上线后更换会导致旧密文无法解密。
- `INVITE_CODE_HMAC_KEY` 用来签发和校验暗号；上线后更换会使已生成暗号失效。

## 8. 可选：阿里云 OSS 新手教学视频

只有客户明确要使用管理后台的视频上传时才配置。需要客户自己的 Bucket、地域、对象前缀、RAM AccessKey，并在 OSS CORS 中允许客户正式站点域名进行 `PUT`、`GET`、`HEAD`。配置顺序见 `CUSTOMER_CONFIGURATION.md`。

## 9. 可选：客户自己的微信支付

默认保持 `WECHAT_PAY_ENABLED=false`。只有客户提供自己的微信支付商户资料、正式 HTTPS 域名和回调条件后，才按 `CUSTOMER_CONFIGURATION.md` 登记 7 个 Secret，并设置：

```bash
npx -y @edgespark/cli var set \
  WECHAT_PAY_NOTIFY_URL=https://客户正式域名/api/webhooks/wechat-pay \
  WECHAT_PAY_ENABLED=true
```

开启前必须实际验证下单、二维码、支付成功回调、金额/商户/AppID/签名校验和会员到期时间。未完成真实验收时必须重新设为 `false`。

## 10. 部署

先做预检，再部署：

```bash
npx -y @edgespark/cli deploy --dry-run
npx -y @edgespark/cli deploy
```

如果客户需要自定义域名：

```bash
npx -y @edgespark/cli domain add app.example.com
npx -y @edgespark/cli domain status app.example.com
```

把 `domain add/status` 返回的 DNS 记录交给客户配置。DNS 生效后执行：

```bash
npx -y @edgespark/cli domain verify app.example.com
```

如果开启微信支付，域名激活后更新 `WECHAT_PAY_NOTIFY_URL` 并重新部署。

## 11. 上线验收清单

必须逐项记录结果：

- `GET /api/public/health` 返回 HTTP 200 和 `ok: true`；
- 无缓存打开真实部署页面，不是本地 Demo 或旧静态资源；
- 新邮箱可直接注册，不要求邮件验证；
- `ADMIN_BOOTSTRAP_EMAIL` 对应账号能看到管理后台入口；
- 未获得权限的普通用户会看到年费/暗号页面；
- 管理员能生成暗号，普通用户使用暗号后获得免年费权限；
- 用户在“服务设置”分别填写自己的 DeepSeek / Image2 Key，页面只回显脱敏状态；
- 文案推理、方案确认、生活类/营销类、参考图、1:1/3:4/9:16/16:9 都能正确进入生成流程；
- 生成任务在刷新或离开页面后仍保留，完成作品进入“我的作品”；
- 高清下载直接下载，历史图片能从本项目 Storage 重新签名读取；
- 管理后台用户和任务列表分页、状态、缩略图和放大预览正常；
- 若配置 OSS：后台上传、发布、用户播放均用客户自己的 OSS 且跨域正常；
- 若配置微信支付：完成一笔真实小范围验收，并核对回调和会员状态；
- 浏览器控制台无阻断错误，手机宽度页面可操作。

## 12. 最终交付报告

向客户明确交付：

1. 新 EdgeSpark 项目名称和项目 ID；
2. EdgeSpark 默认站点地址和自定义域名状态；
3. 首位管理员邮箱；
4. 已配置/未配置项的状态，不得包含任何密钥值；
5. typecheck、lint、build、db check、dry-run、部署和真实页面验收结果；
6. 微信支付是否仍关闭；
7. 源码所在目录、Git 分支/Commit/推送状态（如客户仓库已配置）。
