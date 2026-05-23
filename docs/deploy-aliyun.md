# 阿里云 ECS 正确部署步骤

这份文档以**当前线上实际可用环境**为准，不再使用旧的：

- `/www/wwwroot/highend-site`
- `wanhe68-site`
- `127.0.0.1:3000`

当前线上正确参数是：

- 项目目录：`/root/highend-site`
- PM2 进程名：`highend-site`
- Node 监听：`HOST=127.0.0.1`
- Node 端口：`PORT=4321`

## 1. 正确的上线 / 更新流程

```bash
cd /root/highend-site

# 0. 先确认你在正确的项目目录
ls -la package.json package-lock.json

# 1. 加载 .env
set -a
source ./.env
set +a

# 2. 构建
npm run build

# 3. 如果 PM2 里已有进程，就重启并更新环境变量；
#    如果没有，就直接启动
pm2 describe highend-site >/dev/null 2>&1 \
  && pm2 restart highend-site --update-env \
  || HOST=127.0.0.1 PORT=4321 pm2 start ./dist/server/entry.mjs --name highend-site

# 4. 保存 PM2 进程列表
pm2 save

# 5. 查看状态
pm2 status
```

## 2. 生产环境变量

最少需要配置这些：

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
- 改完 `.env` 后一定要按上面的流程重新 `source ./.env`
- 构建后一定要用 `pm2 restart highend-site --update-env`

## 3. 扩搜密钥自检

### 先确认项目里有没有这个脚本

```bash
cd /root/highend-site
npm run | grep study-abroad:runtime-check
```

### 运行时是否读到了密钥

```bash
cd /root/highend-site
npm run study-abroad:runtime-check
```

正常至少应看到：

- `"externalSearchEnabled": true`
- `"apiKeyPresent": true`

### 做一次真实扩搜探测

```bash
cd /root/highend-site
npm run study-abroad:runtime-check -- --probe --country=英国 --degree=硕士 --major=金融
```

探测通过时，重点看：

- `"probe.attempted": true`
- `"probe.ok": true`
- `"probe.rawReferenceCount"` 大于 `0`

如果这里已经是 `probe.ok = true`，再去前台搜索，候选官网页基本就会开始放量。

## 4. 反向代理要求

Nginx 模板在：

- `deploy/nginx/wanhe68.com.conf`

需要确认所有站点请求都转发到：

- `http://127.0.0.1:4321`

如果改了 Nginx：

```bash
nginx -t
systemctl reload nginx
```

## 5. 上线后验收

### Node 服务是否真的起来

```bash
curl -I http://127.0.0.1:4321/
curl -I http://127.0.0.1:4321/admin/login
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
pm2 logs highend-site --lines 100
```

### 后台搜索放量是否接通

进入：

- `/admin/school-search`

检查这三个点：

- `全网扩搜状态` 是否显示 `已启用`
- 最近搜索留痕里 `候选官网页` 是否开始大于 `0`
- `接入提醒` 不再显示“还未配置百度扩搜密钥”

### 直接打一次搜索接口

```bash
curl -X POST http://127.0.0.1:4321/api/study-abroad/search \
  -H 'Content-Type: application/json' \
  -d '{"country":"英国","degree":"硕士","major":"金融"}'
```

返回里重点看：

- `results`
- `searchSessionId`
- `blockedResultCount`
- `message`

## 6. 当前这版搜索的运行逻辑

- 前台优先返回站内已核验项目
- 满足条件后异步扩搜全网候选官网页
- 管理员可以在后台把不合格结果加入规避名单
- 后续搜索会自动跳过这些结果

这意味着：

- 结果量会比原来大很多
- 但真正放量依赖百度扩搜密钥是否配置成功

## 7. 常见问题排查

### 1) `npm run build` 报 `ENOENT package.json`

说明你不在正确目录。先执行：

```bash
cd /root/highend-site
ls -la package.json package-lock.json
```

只有这里能看到文件，后面的构建才有意义。

### 2) `pm2 restart highend-site` 提示进程不存在

说明这台机器上还没有成功启动过。直接执行：

```bash
cd /root/highend-site
set -a
source ./.env
set +a
npm run build
HOST=127.0.0.1 PORT=4321 pm2 start ./dist/server/entry.mjs --name highend-site
pm2 save
```

### 3) 域名 502

先查：

```bash
curl -I http://127.0.0.1:4321/
```

如果这里不通，说明 Node 服务没起来，不是前台页面本身坏了。

### 4) `/admin` 500 或打不开

先查：

```bash
curl -I http://127.0.0.1:4321/admin/login
ls -ld /root/highend-site/.astro /root/highend-site/.astro/sessions
```

再看：

```bash
pm2 logs highend-site --lines 200
```

### 5) 前台搜索结果量还是不大

优先检查：

- `BAIDU_APPBUILDER_API_KEY` / `BAIDU_SEARCH_API_KEY` 是否已配置
- `npm run study-abroad:runtime-check -- --probe --country=英国 --degree=硕士 --major=金融` 是否通过
- `/admin/school-search` 的 `全网扩搜状态` 是否已启用
- 最近搜索留痕的 `候选官网页` 是否为 `0`
