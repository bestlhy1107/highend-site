module.exports = {
  apps: [
    {
      name: "highend-site",
      cwd: "/root/highend-site",
      script: "./dist/server/entry.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "4321",
      },
    },
  ],
};
