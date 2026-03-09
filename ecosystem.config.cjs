module.exports = {
  apps: [
    {
      name: 'heist-be',
      script: 'node',
      args: '--experimental-specifier-resolution=node packages/backend-nest/dist/main.js',
      cwd: '/srv/solstartup',
      env: {
        NODE_ENV: 'production',
        NEST_PORT: 8081,
      },
      watch: false,
      max_memory_restart: '300M',
      error_file: '/srv/solstartup/logs/be-err.log',
      out_file: '/srv/solstartup/logs/be-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'heist-fe',
      script: 'npx',
      args: 'vite preview --host --port 3000',
      cwd: '/srv/solstartup/packages/frontend',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '200M',
      error_file: '/srv/solstartup/logs/fe-err.log',
      out_file: '/srv/solstartup/logs/fe-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
