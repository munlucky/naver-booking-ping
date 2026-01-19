module.exports = {
  apps: [{
    name: 'naver-booking-ping',
    script: 'dist/main.js',
    interpreter: 'node',
    interpreter_args: '--no-warnings',
    instances: 1,
    exec_mode: 'fork',  // 명시적으로 fork 모드 (cluster 모드는 중복 체크 유발)
    autostart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    // 날짜별 로그 설정 (pm2-logrotate 모듈 필요)
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: false,  // 날짜별 분리를 위해 false
    time: true,  // 로그에 타임스탬프 포함
    // Windows 호환성
    windowsHide: true,
    kill_with_signal: 'SIGINT',
  }]
};
