const https = require('https');
https.get('https://playmist.cgpixels.com/images/games/game-10.png', (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  process.exit(0);
}).on('error', (err) => {
  console.error(err);
  process.exit(1);
});
