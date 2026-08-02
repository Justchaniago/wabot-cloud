module.exports = {
  apps: [
    {
      name: 'telegram-server',
      script: 'telegram-bot.js',
      instances: 1,
      autorestart: true,
      watch: false, // JANGAN set true (sangat boros CPU/Disk I/O di VM GCP)
      max_memory_restart: '200M', // Batasan RAM maksimal untuk efisiensi total
      exp_backoff_restart_delay: 3000, // Mulai dari jeda 3 detik jika crash beruntun
      max_restarts: 10, // Maksimal restart cepat beruntun sebelum berhenti total demi efisiensi resource
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
