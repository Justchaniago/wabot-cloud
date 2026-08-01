import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Server, Activity, Bot, Cpu as AiIcon, Terminal, 
  RefreshCw, Send, AlertTriangle, QrCode, 
  Wrench, MessageSquare, Zap, ShieldAlert, Trash2
} from 'lucide-react';
import './App.css';

const socket = io('/', { autoConnect: true });

export default function App() {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'troubleshoot' | 'ai-chat' | 'terminal'
  const [status, setStatus] = useState({
    server: { uptime: 0, memory: '0 MB', cpu: '0%' },
    waBot: { connected: false, session: 'firestore-default', rawQr: null },
    ai: { ready: true }
  });
  const [logs, setLogs] = useState([]);
  const [pairingCode, setPairingCode] = useState(null);
  
  // Chat State
  const [chatMessages, setChatMessages] = useState([
    { sender: 'ai', text: 'Halo! Saya AI Assistant Gemini 2.5 Flash terintegrasi server.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Terminal Exec State
  const [terminalCmd, setTerminalCmd] = useState('');
  const chatEndRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    socket.on('connect', () => {
      addLog('INFO', 'Connected to Mobile Control Center');
    });

    socket.on('server:stats', (data) => {
      setStatus(prev => ({ ...prev, server: data }));
    });

    socket.on('wabot:status', (data) => {
      setStatus(prev => ({ ...prev, waBot: { ...prev.waBot, ...data } }));
    });

    socket.on('log:stream', (log) => {
      addLog(log.type, log.message);
    });

    return () => {
      socket.off('connect');
      socket.off('server:stats');
      socket.off('wabot:status');
      socket.off('log:stream');
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'ai-chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    if (activeTab === 'terminal') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, chatMessages, activeTab]);

  const addLog = (type, message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), { timestamp, type, message }]);
  };

  const handleAction = async (endpoint, payload = {}) => {
    addLog('WARN', `Action: ${endpoint}`);
    try {
      const res = await fetch(`/api/panel/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      addLog(data.success ? 'SUCCESS' : 'ERROR', data.message || 'Action complete');
      return data;
    } catch (err) {
      addLog('ERROR', 'Failed: ' + err.message);
    }
  };

  const handleSendAiMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userText = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setChatLoading(true);

    try {
      const res = await fetch('/api/panel/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userText })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { sender: 'ai', text: data.reply || data.error || 'Gagal memproses respon.' }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: 'ai', text: 'Error: ' + err.message }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleRunCommand = (e) => {
    e.preventDefault();
    if (!terminalCmd.trim()) return;
    const cmd = terminalCmd;
    setTerminalCmd('');
    addLog('INFO', `$ ${cmd}`);
    handleAction('exec-command', { command: cmd });
  };

  return (
    <div className="mobile-app-shell">
      {/* Top Header */}
      <header className="top-bar">
        <div className="top-brand">
          <span className="top-brand-badge">by Chaniago</span>
          <h1>Whatsapp Bot Console</h1>
        </div>
        <span className={`status-pill ${status.waBot.connected ? '' : 'offline'}`}>
          {status.waBot.connected ? '● LIVE' : '○ OFFLINE'}
        </span>
      </header>

      {/* Navigation Tabs */}
      <nav className="tab-row">
        <button className={`tab-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          <Activity size={16} /> Stats
        </button>
        <button className={`tab-item ${activeTab === 'troubleshoot' ? 'active' : ''}`} onClick={() => setActiveTab('troubleshoot')}>
          <Wrench size={16} /> Fix
        </button>
        <button className={`tab-item ${activeTab === 'ai-chat' ? 'active' : ''}`} onClick={() => setActiveTab('ai-chat')}>
          <MessageSquare size={16} /> AI Chat
        </button>
        <button className={`tab-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
          <Terminal size={16} /> Console
        </button>
      </nav>

      {/* Viewport Content Area */}
      <div className="tab-viewport">
        {/* TAB 1: STATS */}
        {activeTab === 'overview' && (
          <>
            <section className="mobile-card">
              <div className="card-head">
                <span>Server & Environment Specs</span>
                <Server size={16} />
              </div>
              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-lbl">Uptime</span>
                  <div className="metric-val">{Math.floor(status.server.uptime / 60)}m {status.server.uptime % 60}s</div>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">RAM Used</span>
                  <div className="metric-val">{status.server.memory || '58 MB'}</div>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">CPU Load</span>
                  <div className="metric-val">{status.server.cpu || '1%'}</div>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">OS Platform</span>
                  <div className="metric-val" style={{ fontSize: '0.9rem' }}>Ubuntu 22.04</div>
                </div>
              </div>
            </section>

            <section className="mobile-card">
              <div className="card-head">
                <span>WhatsApp Bot Session & Controls</span>
                <Bot size={16} />
              </div>
              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-lbl">Session ID</span>
                  <div className="metric-val" style={{ fontSize: '0.9rem' }}>{status.waBot.session}</div>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">Database Auth</span>
                  <div className="metric-val" style={{ fontSize: '0.9rem' }}>Firestore Sync</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button className="btn-m btn-m-danger" onClick={() => handleAction('restart-bot')}>
                  <RefreshCw size={14} /> Restart Bot
                </button>
                <button className="btn-m btn-m-lime" onClick={() => handleAction('reconnect-bot')}>
                  <Zap size={14} /> Reconnect
                </button>
              </div>
            </section>

            <section className="mobile-card">
              <div className="card-head">
                <span>Bot Features & Command Registry</span>
                <Activity size={16} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['/ai', '/report', '/status', '/closingbreafingpms', '/closingbreafingtp', '/dailyso', '/produksi', '/mastercommand'].map((cmd, idx) => (
                  <span key={idx} style={{
                    background: '#0f172a',
                    color: '#a3e635',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    padding: '4px 8px',
                    borderRadius: '4px'
                  }}>
                    {cmd}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}

        {/* TAB 2: TROUBLESHOOT & PAIRING */}
        {activeTab === 'troubleshoot' && (
          <>
            <section className="mobile-card">
              <div className="card-head">
                <span>Request Kode Pairing WhatsApp</span>
                <QrCode size={16} />
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const phone = e.target.phone.value;
                if (!phone) return;
                const data = await handleAction('request-pairing', { phone });
                if (data && data.code) {
                  setPairingCode(data.code);
                }
              }} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input 
                  type="text" 
                  name="phone"
                  className="input-m" 
                  placeholder="Contoh: 628123456789" 
                  required
                />
                <button type="submit" className="btn-m btn-m-lime">
                  <Zap size={14} /> Dapatkan Kode Pairing
                </button>
              </form>

              {pairingCode && (
                <div style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  border: '2px solid #0f172a',
                  padding: '12px',
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 800,
                  fontSize: '1.4rem',
                  letterSpacing: '4px',
                  marginTop: '8px'
                }}>
                  {pairingCode}
                </div>
              )}
            </section>

            <section className="mobile-card">
              <div className="card-head">
                <span>Scan QR Code</span>
                <QrCode size={16} />
              </div>
              {status.waBot.rawQr ? (
                <div style={{ textAlign: 'center' }}>
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(status.waBot.rawQr)}`} 
                    alt="QR Code" 
                    style={{ border: '2px solid #0f172a', padding: '6px', background: 'white', maxWidth: '100%' }}
                  />
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, marginTop: '6px' }}>Scan via WhatsApp Linked Devices</p>
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>Status: WA Bot terhubung & normal (Atau gunakan pairing code di atas).</p>
              )}
            </section>

            <section className="mobile-card">
              <div className="card-head">
                <span>Fix & Reset Actions</span>
                <ShieldAlert size={16} />
              </div>
              <button className="btn-m btn-m-danger" onClick={() => handleAction('clear-session')}>
                <Trash2 size={14} /> Reset Firestore Session
              </button>
            </section>
          </>
        )}

        {/* TAB 3: PROPER AI CHAT */}
        {activeTab === 'ai-chat' && (
          <div className="chat-container">
            <div className="chat-history">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble ${msg.sender}`}>
                  {msg.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendAiMessage} className="input-row">
              <input 
                type="text" 
                className="input-m"
                placeholder="Tanya AI Gemini..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
              />
              <button type="submit" className="btn-m btn-m-lime" style={{ width: 'auto', padding: '0 16px' }} disabled={chatLoading}>
                <Send size={16} />
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: TERMINAL CONSOLE */}
        {activeTab === 'terminal' && (
          <div className="chat-container">
            <div className="terminal-screen">
              {logs.map((item, idx) => (
                <div key={idx} className={`log-entry tag-${item.type.toLowerCase()}`}>
                  [{item.timestamp}] [{item.type}] {item.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
            <form onSubmit={handleRunCommand} className="input-row">
              <input 
                type="text" 
                className="input-m"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                placeholder="Ketik command..."
                value={terminalCmd}
                onChange={e => setTerminalCmd(e.target.value)}
              />
              <button type="submit" className="btn-m btn-m-purple" style={{ width: 'auto', padding: '0 16px' }}>
                Run
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
