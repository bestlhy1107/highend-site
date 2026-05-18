# 阿里云 ECS 部署与搜索放量清单

适用域名：

- `www.wanhe68.com`
- `wanhe68.com`

适用目录：

- `/www/wwwroot/highend-site`

## 1. 首次部署

```bash
cd /www/wwwroot
git clone https://github.com/bestlhy1107/highend-site.git highend-site
cd /www/wwwroot/highend-site
cp .env.example .env
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

如果已经有旧目录，先备份再覆盖：

```bash
mv /www/wwwroot/highend-site /www/wwwroot/highend-site-backup-$(date +%F-%H%M%S)
```

## 2. 生产环境变量

最少需要配置这些变量：

```env
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-admin-password

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=bot@example.com
SMTP_PASS=replace-me
LEAD_TO_EMAIL=ops@example.com
MAIL_FROM=Wanhe Education <bot@example.com>
```

如果要让留学院校搜索真正从全网补候选官网页，还需要至少配置下面任意一个：

```env
BAIDU_APPBUILDER_API_KEY=replace-me
```

或：

```env
BAIDU_SEARCH_API_KEY=replace-me
```

可选：

```env
BAIDU_SEARCH_MODEL=ernie-4.5-turbo-32k
COLLEGE_SCORECARD_API_KEY=replace-me
```

推荐做法：

- 优先只配 `BAIDU_APPBUILDER_API_KEY`
- 改完 `.env` 后一定要重启 PM2
- 重启后立刻跑一次运行时自检，不要只看后台文案

## 3. 日常更新

```bash
cd /www/wwwroot/highend-site
git pull origin main
npm ci
npm run build
pm2 restart wanhe68-site
```

如果改了 PM2 配置：

```bash
pm2 delete wanhe68-site
pm2 start ecosystem.config.cjs
pm2 save
```

## 4. 反向代理要求

Nginx 模板在：

- `deploy/nginx/wanhe68.com.conf`

需要确认所有站点请求都转发到：

- `http://127.0.0.1:3000`

如果改了 Nginx：

```bash
nginx -t
systemctl reload nginx
```

## 5. 上线后验收

### 先验证扩搜密钥是否真正被运行时读到

```bash
cd /www/wwwroot/highend-site
npm run study-abroad:runtime-check
```

正常至少应看到：

- `"externalSearchEnabled": true`
- `"apiKeyPresent": true`

如果你想进一步确认接口能真的打通，再跑一遍探测：

```bash
cd /www/wwwroot/highend-site
npm run study-abroad:runtime-check -- --probe --country=英国 --degree=硕士 --major=金融
```

探测通过时，重点看：

- `"probe.attempted": true`
- `"probe.ok": true`
- `"probe.rawReferenceCount"` 大于 `0`

如果这里已经是 `probe.ok = true`，再去前台搜索，候选官网页基本就会开始放量。

### Node 服务是否真的起来

```bash
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3000/admin/login
```

正常结果：

- 首页返回 `200`
- `/admin/login` 返回 `200`

### 域名是否正常

```bash
curl -I https://www.wanhe68.com/
curl -I https://www.wanhe68.com/admin/login
```

### PM2 状态

```bash
pm2 status
pm2 logs wanhe68-site --lines 100
```

### 后台搜索放量是否接通

进入：

- `/admin/school-search`

检查这三个点：

- `全网扩搜状态` 是否显示 `已启用`
- 最近搜索留痕里 `候选官网页` 是否开始大于 `0`
- `接入提醒` 不再显示“还未配置百度扩搜密钥”

如果后台还是显示未启用，但你已经改了 `.env`，优先执行：

```bash
cd /www/wwwroot/highend-site
pm2 restart wanhe68-site
npm run study-abroad:runtime-check
```

### 直接打一次搜索接口

```bash
curl -X POST http://127.0.0.1:3000/api/study-abroad/search \
  -H 'Content-Type: application/json' \
  -d '{"country":"英国","degree":"硕士","major":"金融"}'
```

返回里重点看：

- `results`
- `searchSessionId`
- `blockedResultCount`
- `message`

如果线上已经接通扩搜，再继续观察后台：

- `/admin/school-search`

应该会逐步出现：

- 搜索留痕
- 候选官网页
- 可规避结果

## 6. 当前这版搜索的运行逻辑

- 前台优先返回站内已核验项目
- 满足条件后异步扩搜全网候选官网页
- 管理员可以在后台把不合格结果加入规避名单
- 后续搜索会自动跳过这些结果

这意味着：

- 结果量会比原来大很多
- 但真正放量依赖百度扩搜密钥是否配置成功

## 7. 常见问题排查

### 1) 域名 502

先查：

```bash
curl -I http://127.0.0.1:3000/
```

如果这里不通，说明 Node 服务没起来，不是前台页面本身坏了。

### 2) `/admin` 500 或打不开

先查：

```bash
curl -I http://127.0.0.1:3000/admin/login
ls -ld /www/wwwroot/highend-site/.astro /www/wwwroot/highend-site/.astro/sessions
```

再看：

```bash
pm2 logs wanhe68-site --lines 200
```

### 3) 前台搜索结果量还是不大

优先检查：

- `BAIDU_APPBUILDER_API_KEY` / `BAIDU_SEARCH_API_KEY` 是否已配置
- `npm run study-abroad:runtime-check -- --probe --country=英国 --degree=硕士 --major=金融` 是否通过
- `/admin/school-search` 的 `全网扩搜状态` 是否已启用
- 最近搜索留痕的 `候选官网页` 是否为 `0`

### 4) 结果很多但不准

去：

- `/admin/school-search`

处理：

- `后续规避这条`
- `规避整个站点`
- `恢复显示`

管理员的规避动作会直接影响后续搜索结果。
