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
        HOST: "0.0.0.0",
        PORT: "3000",
      },
    },
  ],
};
