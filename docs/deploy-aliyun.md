# 阿里云部署说明

适用域名：

- `www.wanhe68.com`
- `wanhe68.com`

## 1. 服务器建议目录

推荐目录：

```bash
/www/wwwroot/highend-site
```

## 2. 首次部署

```bash
cd /www/wwwroot
git clone git@github.com:bestlhy1107/highend-site.git
cd highend-site
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

如果使用本仓库提供的 PM2 配置，需要确认：

- 代码目录确实是 `/www/wwwroot/highend-site`
- `.env` 已放到项目目录

## 3. 更新部署

```bash
cd /www/wwwroot/highend-site
git pull
npm install
npm run build
pm2 reload wanhe68-site
```

## 4. Nginx 配置

仓库里已经提供模板：

```text
deploy/nginx/wanhe68.com.conf
```

重点能力：

- `https` 强制跳转
- `www` 统一
- `/_astro/` 静态资源长缓存
- `js / css / 图片 / 字体` 长缓存
- `gzip` 压缩

## 5. 当前这版性能优化重点

这次代码已经补了两层关键优化：

1. 大 JSON 底库文件加了进程内缓存
2. 首页和择校页首屏不再同步读取整套 2 万多条项目库

所以线上部署后，首屏响应会比原来明显更稳。

## 6. 发布后验证

### 首页

```bash
curl -L -o /dev/null -s -w 'home ttfb:%{time_starttransfer} total:%{time_total}\n' https://www.wanhe68.com/
```

### 择校页

```bash
curl -L -o /dev/null -s -w 'finder ttfb:%{time_starttransfer} total:%{time_total}\n' https://www.wanhe68.com/school-finder
```

### PM2 状态

```bash
pm2 status
pm2 logs wanhe68-site --lines 100
```

### Nginx 检查

```bash
nginx -t
systemctl reload nginx
```

## 7. 如果线上仍然很慢，优先检查

1. `pm2 status` 里 Node 进程是否频繁重启
2. 服务器 CPU / 内存是否过低
3. `/_astro/` 是否命中长缓存
4. `.env` 是否正确，避免页面请求外部接口超时
5. 是否仍在用旧代码目录或旧 PM2 进程
