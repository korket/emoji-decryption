module.exports = {
  apps: [
    {
      name: 'emoguessr',
      script: './node_modules/.bin/tsx',
      args: 'src/main.ts',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
