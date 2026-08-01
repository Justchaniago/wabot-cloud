const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { GoogleGenAI } = require('@google/genai');

function setupPanelServer(app, server) {
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  // Serve static assets from panel/dist if built
  const panelDistPath = path.join(__dirname, 'panel', 'dist');
  app.use('/panel', express.static(panelDistPath));

  // Helper log broadcaster
  const broadcastLog = (type, message) => {
    io.emit('log:stream', { type, message });
  };

  // Helper WA Bot status broadcaster
  const broadcastWaBotStatus = (data) => {
    io.emit('wabot:status', data);
  };

  // Broadcast server stats every 3 seconds
  setInterval(() => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemMB = Math.round((totalMem - freeMem) / (1024 * 1024));
    
    io.emit('server:stats', {
      uptime: Math.floor(process.uptime()),
      memory: `${usedMemMB} MB`,
      cpu: `${Math.round((1 - freeMem / totalMem) * 100)}%`
    });
  }, 3000);

  app.post('/api/panel/restart-bot', (req, res) => {
    broadcastLog('WARN', 'Restart signal received from Web Control Panel');
    if (global.restartWaBotHandler) {
      global.restartWaBotHandler();
    }
    res.json({ success: true, message: 'Restart triggered' });
  });

  app.post('/api/panel/request-pairing', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Nomor telepon wajib diisi' });
    
    broadcastLog('INFO', `Requesting pairing code for: ${phone}`);
    if (global.requestPairingCodeHandler) {
      try {
        const code = await global.requestPairingCodeHandler(phone);
        res.json({ success: true, code, message: 'Kode pairing berhasil dibuat' });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.status(500).json({ success: false, error: 'WhatsApp socket belum siap' });
    }
  });

  app.post('/api/panel/reconnect-bot', (req, res) => {
    broadcastLog('INFO', 'Reconnect signal triggered from Mobile Panel');
    if (global.restartWaBotHandler) global.restartWaBotHandler();
    res.json({ success: true, message: 'Reconnection sequence initiated' });
  });

  app.post('/api/panel/clear-session', (req, res) => {
    broadcastLog('WARN', 'Session reset triggered from Mobile Panel');
    if (global.clearFirestoreSessionHandler) global.clearFirestoreSessionHandler();
    res.json({ success: true, message: 'Firestore session reset triggered' });
  });

  app.post('/api/panel/exec-command', (req, res) => {
    const { command } = req.body;
    broadcastLog('INFO', `Terminal Exec: ${command}`);
    
    const { exec } = require('child_process');
    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        broadcastLog('ERROR', `Exec Error: ${error.message}`);
        return res.json({ success: false, output: error.message });
      }
      const out = stdout || stderr || 'Command executed with no output';
      broadcastLog('SUCCESS', out);
      res.json({ success: true, output: out });
    });
  });

  app.post('/api/panel/test-ai', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const startTime = Date.now();
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      let ai;
      if (apiKey) {
        ai = new GoogleGenAI({ apiKey });
      } else {
        const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'project-a2bb3a13-c8e1-4097-92d';
        ai = new GoogleGenAI({ vertexai: true, project, location: 'us-central1' });
      }

      // Collect real-time server stats for AI system prompt context
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMemMB = Math.round((totalMem - freeMem) / (1024 * 1024));
      const uptimeSec = Math.floor(process.uptime());
      const cpuUsage = `${Math.round((1 - freeMem / totalMem) * 100)}%`;

      const systemContext = `Anda adalah AI DevOps Assistant cerdas terintegrasi langsung di WABOT Control Panel.
Anda memiliki akses REAL-TIME ke status server dan WhatsApp Bot saat ini:
- Server Uptime: ${Math.floor(uptimeSec / 60)} menit ${uptimeSec % 60} detik
- Penggunaan Memori/RAM: ${usedMemMB} MB / ${Math.round(totalMem / (1024 * 1024))} MB
- Estimasi CPU Load: ${cpuUsage}
- Platform OS: ${os.type()} ${os.release()} (${os.arch()})
- Node.js Version: ${process.version}
- GCP Project ID: project-a2bb3a13-c8e1-4097-92d (wabot-server)

Jawab pertanyaan user secara singkat, tepat, ramah, dan gunakan data statistik real-time di atas jika ditanyakan.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: systemContext
        }
      });

      const latency = Date.now() - startTime;
      broadcastLog('SUCCESS', `AI Assistant response generated in ${latency}ms`);
      res.json({ success: true, reply: response.text, latency });
    } catch (err) {
      const latency = Date.now() - startTime;
      broadcastLog('ERROR', `AI Assistant error: ${err.message}`);
      res.json({ success: false, error: err.message, latency });
    }
  });

  io.on('connection', (socket) => {
    broadcastLog('INFO', `Panel Client Connected [ID: ${socket.id}]`);
  });

  return { io, broadcastLog, broadcastWaBotStatus };
}

module.exports = setupPanelServer;
