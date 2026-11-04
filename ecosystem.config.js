module.exports = {
  apps: [
    {
      name: "youconstruct-api",
      script: "dist/src/main.js",
      cwd: "/var/www/0b81a939-b91e-4464-b67c-a465d1d160f2/public_html/current",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
