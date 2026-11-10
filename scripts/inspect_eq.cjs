const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    try {
      const list = JSON.parse(data);
      const p = list.find(t => t.type === 'page');
      if (!p) {
        console.log('No page found');
        return;
      }
      const ws = new WebSocket(p.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              JSON.stringify({
                layers: Array.from(document.querySelectorAll('.liquid-btn-layer')).map(l => ({
                  className: l.className,
                  rect: l.getBoundingClientRect(),
                  bars: Array.from(l.querySelectorAll('.eq-bar')).map(b => ({
                    rect: b.getBoundingClientRect(),
                    bg: window.getComputedStyle(b).backgroundColor,
                    h: window.getComputedStyle(b).height,
                  }))
                }))
              })
            `
          }
        }));
      };
      ws.onmessage = (e) => {
        console.log(e.data);
        process.exit(0);
      };
    } catch(err) {
      console.error(err);
    }
  });
});

