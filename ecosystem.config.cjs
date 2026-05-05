module.exports = {
  apps: [
    {
      name: "wanhe68-site",
      cwd: "/www/wwwroot/highend-site",
      script: "npm",
      args: "run start",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
