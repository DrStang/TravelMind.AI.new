/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

module.exports = {
    experimental: { serverActions: { bodySizeLimit: '2mb' } },
    output: 'standalone',
    async rewrites() {
        if (isDev) {
            // useful when running web directly without nginx
            return [{ source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' }];
        }
        return [];
    },
};
