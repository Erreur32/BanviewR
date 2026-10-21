import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3025),
  // Loopback by default: this UI drives the host firewall
  host: process.env.HOST ?? '127.0.0.1',
  isDev: process.env.NODE_ENV !== 'production',
};
