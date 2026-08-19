# 客户配置字段说明

所有字段名以 `server/src/defs/runtime.ts` 为准。普通 Var 可以由 Agent 用 CLI 设置；Secret 只能由 Agent 创建安全填写链接，再由客户本人在 EdgeSpark 网页填写。

## A. 基础必配

| 类型 | 字段 | 用途 | 客户从哪里获得 |
|---|---|---|---|
| Var | `ADMIN_BOOTSTRAP_EMAIL` | 首位管理员邮箱 | 客户自己的常用邮箱 |
| Var | `DEEPSEEK_API_BASE` | DeepSeek API 地址 | 默认 `https://api.deepseek.com` |
| Var | `IMAGE2_API_BASE` | Image2 API 地址 | 默认 `https://openapi.yiminju.xyz/api/public/v1` |
| Secret | `USER_CREDENTIAL_MASTER_KEY` | 加密用户独立 API Key | Agent 用 `openssl rand -base64 32` 现场生成 |
| Secret | `INVITE_CODE_HMAC_KEY` | 生成和校验免年费暗号 | Agent 用 `openssl rand -base64 32` 另生成一个不同值 |

## B. 用户自己的 AI Key

这两个 Key 不是部署环境变量，也不交给部署 Agent：

| Key | 填写位置 | 获取地址 |
|---|---|---|
| DeepSeek API Key | 用户登录后，网页右上角“服务设置” | <https://platform.deepseek.com/sign_in> |
| Image2 API Key | 用户登录后，网页右上角“服务设置” | <https://openapi.yiminju.xyz/login> |

每位用户的两个 Key 按账号隔离，并用 `USER_CREDENTIAL_MASTER_KEY` 加密后保存。管理后台只显示是否已配置，不返回原值。

## C. 微信支付（可选）

默认应设置：

```text
WECHAT_PAY_ENABLED=false
WECHAT_PAY_API_BASE=https://api.mch.weixin.qq.com
WECHAT_PAY_ORDER_EXPIRE_MINUTES=30
WECHAT_PAY_CURRENCY=CNY
```

正式开启还需要：

| 类型 | 字段 | 说明 |
|---|---|---|
| Var | `WECHAT_PAY_NOTIFY_URL` | `https://客户正式域名/api/webhooks/wechat-pay` |
| Secret | `WECHAT_PAY_MCH_ID` | 客户自己的微信支付商户号 |
| Secret | `WECHAT_PAY_APP_ID` | 与商户号绑定的客户 AppID |
| Secret | `WECHAT_PAY_MERCHANT_SERIAL_NO` | 商户 API 证书序列号 |
| Secret | `WECHAT_PAY_API_V3_KEY` | 客户在微信支付平台设置的 API v3 Key |
| Secret | `WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM` | 商户 API 私钥 PEM 全文 |
| Secret | `WECHAT_PAY_PUBLIC_KEY_ID` | 当前微信支付公钥 ID/序列标识 |
| Secret | `WECHAT_PAY_PUBLIC_KEY_PEM` | 与上面 ID 对应的微信支付公钥 PEM 全文 |

登记密钥名称：

```bash
npx -y @edgespark/cli secret set \
  WECHAT_PAY_MCH_ID \
  WECHAT_PAY_APP_ID \
  WECHAT_PAY_MERCHANT_SERIAL_NO \
  WECHAT_PAY_API_V3_KEY \
  WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM \
  WECHAT_PAY_PUBLIC_KEY_ID \
  WECHAT_PAY_PUBLIC_KEY_PEM
```

Agent 只把返回的安全填写 URL 给客户，客户到微信支付商户平台查看自己的资料并填入。

当前源码默认价格为 800 元/年。价格同时涉及服务端套餐、订单金额、前端文案和默认展示；如需改价，必须让 Agent 做全链路修改并重新验证支付金额，不能只改页面文字。

如果微信支付尚未配置，管理员仍可生成暗号，或在管理后台为用户开通权限。

## D. 阿里云 OSS 新手教学视频（可选）

| 类型 | 字段 | 示例/说明 |
|---|---|---|
| Var | `ALIYUN_OSS_BUCKET` | 客户自己的 Bucket 名，不带协议和域名 |
| Var | `ALIYUN_OSS_REGION` | 例如 `cn-guangzhou`，不要写成 `oss-cn-guangzhou` |
| Var | `ALIYUN_OSS_OBJECT_PREFIX` | 建议 `wechat-poster-agent/tutorials` |
| Secret | `ALIYUN_OSS_ACCESS_KEY_ID` | 客户自己的 RAM AccessKey ID |
| Secret | `ALIYUN_OSS_ACCESS_KEY_SECRET` | 与上面 ID 匹配的 RAM AccessKey Secret |

普通变量：

```bash
npx -y @edgespark/cli var set \
  ALIYUN_OSS_BUCKET=客户Bucket名 \
  ALIYUN_OSS_REGION=客户地域 \
  ALIYUN_OSS_OBJECT_PREFIX=wechat-poster-agent/tutorials
```

密钥安全填写：

```bash
npx -y @edgespark/cli secret set ALIYUN_OSS_ACCESS_KEY_ID ALIYUN_OSS_ACCESS_KEY_SECRET
```

OSS 还必须配置：

- RAM 权限仅授予指定 Bucket/对象前缀所需的上传、读取和检查权限；
- CORS Allowed Origins 包含 EdgeSpark 默认站点和客户正式域名；
- Allowed Methods 至少包含 `PUT`、`GET`、`HEAD`；
- Allowed Headers 至少允许 `Content-Type` 及浏览器实际预检请求使用的头；
- Expose Headers 建议包含 `ETag`；
- Bucket 建议保持私有，由服务端生成限时签名 URL。

## E. 注册与域名

- 认证模板：`configs/auth-config.customer.yaml`；
- 默认允许邮箱密码注册；
- 默认不做邮件验证；
- 自定义域名通过 `edgespark domain add/status/verify` 配置；
- 微信或其他平台要求的站点根目录 TXT 验证文件，必须使用客户平台生成的新文件，放到 `web/public/` 后重新构建部署；不要复用交付方的验证文件。

## F. 不能提交到 Git 的内容

- `.env`、`.env.local`、`.env.*.local`；
- EdgeSpark 安全页面中填写的任何值；
- PEM 私钥、公钥证书文件、支付平台下载包；
- OSS AccessKey；
- 本地数据库、用户导出、作品文件、日志；
- `.edgespark/`、`node_modules/`、`dist/`。
