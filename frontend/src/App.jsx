import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal, Database, Code2, Zap, BrainCircuit, Play,
  XCircle, ChevronRight, Sun, Moon,
  Activity, User, LogOut, History, Clock, RefreshCcw, UserCog, Settings,
  ShieldCheck, Trash2, ArrowDownCircle, Info, Eye, EyeOff, Lock, Loader2,
  PanelLeftClose, PanelLeftOpen, Copy, Check, Sparkles
} from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './index.css';

const API_BASE_URL = import.meta.env.VITE_API_URL;

// API Fetcher with Auto-Logout on 401
const apiFetch = async (endpoint, options = {}, token, onUnauthorized) => {
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
    throw new Error('Unauthorized');
  }
  return response;
};

function App() {
  const [ingestUrl, setIngestUrl] = useState('');
  const [task, setTask] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [theme, setTheme] = useState('dark');

  // Auth state
  const [currentUser, setCurrentUser] = useState(() => JSON.parse(localStorage.getItem('currentUser')) || JSON.parse(sessionStorage.getItem('currentUser')) || null);
  const [accountModal, setAccountModal] = useState(false);
  const [accountForm, setAccountForm] = useState({ username: '', password: '' });
  const [isAccountUpdating, setIsAccountUpdating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'login' });
  const [authForm, setAuthForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const usernameInputRef = useRef(null);

  useEffect(() => {
    if (authModal.isOpen) {
      setTimeout(() => usernameInputRef.current?.focus(), 100);
    }
  }, [authModal.isOpen, authModal.mode]);

  // History state
  const [historyModal, setHistoryModal] = useState(false);
  const [jobHistory, setJobHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [viewLogModal, setViewLogModal] = useState({ isOpen: false, logs: '' });

  // UI features state
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const streamEndRef = useRef(null);
  const taskTextareaRef = useRef(null);

  useEffect(() => {
    if (taskTextareaRef.current) {
      taskTextareaRef.current.style.height = 'auto';
      taskTextareaRef.current.style.height = `${Math.min(taskTextareaRef.current.scrollHeight, 200)}px`;
    }
  }, [task]);

  const CodeBlock = ({ inline, className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const [copied, setCopied] = useState(false);
    const code = String(children).replace(/\n$/, '');
    const handleCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    return !inline && match ? (
      <div style={{ position: 'relative', marginTop: '1rem', marginBottom: '1rem', borderRadius: '6px', overflow: 'hidden' }}>
        <button
          onClick={handleCopy}
          style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', padding: '6px', cursor: 'pointer', color: copied ? '#10b981' : '#fff', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Copy code"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0 }}
          {...props}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    ) : (
      <code className={className} style={{ backgroundColor: 'rgba(0,0,0,0.1)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }} {...props}>
        {children}
      </code>
    );
  };

  const scrollContainerRef = useRef(null);
  const wsRef = useRef(null); const [hitlPrompt, setHitlPrompt] = useState(null); const [hitlInput, setHitlInput] = useState('');;

  useEffect(() => {
    if (currentUser) {
      if (rememberMe) {
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      } else {
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      }
      // fetch history silently to update dashboard analytics
      fetchHistory(true);
    } else {
      localStorage.removeItem('currentUser');
      sessionStorage.removeItem('currentUser');
      setJobHistory([]);
    }
  }, [currentUser, rememberMe]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isScrolledUp) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isScrolledUp]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight > 50) {
      setIsScrolledUp(true);
    } else {
      setIsScrolledUp(false);
    }
  };

  const forceLogout = (expired = false) => {
    setCurrentUser(null);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setIsRunning(false);
    }
    if (expired) toast.error('Session expired. Please login again.');
  };

  const handleLogout = () => {
    forceLogout();
    toast.success('Logged out securely.');
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleIngest = async () => {
    if (!ingestUrl) return;

    // Basic URL validation
    try {
      new URL(ingestUrl);
    } catch {
      toast.error('Please enter a valid URL (e.g. https://...)');
      return;
    }

    setIsIngesting(true);
    try {
      const res = await apiFetch('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ingestUrl })
      }, currentUser?.token, () => forceLogout(true));

      const data = await res.json();
      if (res.ok) toast.success(data.message);
      else toast.error('Ingestion failed');
    } catch (err) {
      if (err.message !== 'Unauthorized') toast.error('Error connecting to backend');
    }
    setIsIngesting(false);
  };


  const handleRunAgent = (retryJobId = null) => {
    if (!task && !retryJobId) {
      toast.error('Please provide a task.');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setIsScrolledUp(false);
    setHitlPrompt(null);
    setHitlInput('');

    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/agent/';

    // Pass username to track the websocket connection uniquely
    const wsUser = currentUser ? currentUser.username : 'anonymous_' + Math.random().toString(36).substring(7);
    wsUrl += wsUser + '?';

    if (retryJobId) {
      wsUrl += `job_id=${retryJobId}`;
    } else {
      wsUrl += `task=${encodeURIComponent(task)}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    toast.success('Agent execution started');

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.event === 'message') {
        setLogs((prev) => {
          const newLogs = [...prev, payload.data];
          return newLogs.length > 300 ? newLogs.slice(newLogs.length - 300) : newLogs;
        });
      } else if (payload.event === 'paused') {
        setHitlPrompt({ message: payload.message, node: payload.node });
        toast('Agent paused waiting for feedback', { icon: '✋' });
      } else if (payload.event === 'resumed') {
        setHitlPrompt(null);
        setHitlInput('');
        toast.success(payload.message);
      } else if (payload.event === 'error') {
        toast.error('Agent Error: ' + payload.message);
      } else if (payload.event === 'interrupted') {
        toast.error(payload.message);
      } else if (payload.event === 'finished') {
        setIsRunning(false);
        ws.close();
        toast.success(payload.message);
        fetchHistory(true);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      toast.error('Agent connection error');
    };

    ws.onclose = () => {
      setIsRunning(false);
      setHitlPrompt(null);
      fetchHistory(true);
    };
  };

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'interrupt' }));
      wsRef.current.close();
      toast('Agent forcefully stopped', { icon: '🛑' });
    }
  };

  const submitFeedback = (e) => {
    e.preventDefault();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'feedback', data: hitlInput }));
    }
  };
  const clearLogs = () => {
    setLogs([]);
    toast('Console cleared', { icon: '🧹' });
  };

  const fetchHistory = async (silent = false) => {
    if (!currentUser) return;
    if (!silent) setIsLoadingHistory(true);
    try {
      const res = await apiFetch(`/jobs?username=${currentUser.username}`, {}, currentUser.token, () => forceLogout(true));
      const data = await res.json();
      if (res.ok) setJobHistory(data);
      else if (!silent) toast.error('Failed to fetch history');
    } catch (err) {
      if (err.message !== 'Unauthorized' && !silent) toast.error('Network error');
    }
    if (!silent) setIsLoadingHistory(false);
  };

  const openHistory = () => {
    fetchHistory();
    setHistoryModal(true);
  };

  const handleRetryJob = async (jobId) => {
    setHistoryModal(false);
    try {
      const res = await apiFetch(`/jobs/${jobId}/retry`, { method: 'POST' }, currentUser?.token, () => forceLogout(true));
      if (res.ok) {
        handleRunAgent(jobId);
      } else {
        toast.error('Failed to retry job');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') toast.error('Network error');
    }
  };

  const handleDeleteJob = async (jobId) => {
    try {
      const res = await apiFetch(`/jobs/${jobId}`, { method: 'DELETE' }, currentUser?.token, () => forceLogout(true));
      if (res.ok) {
        setJobHistory(prev => prev.filter(j => j.id !== jobId));
        toast.success('Job deleted');
      } else {
        toast.error('Failed to delete job');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') toast.error('Network error');
    }
  };

  // Auth Submit
  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    if (!accountForm.username && !accountForm.password) {
      toast.error('Please provide a new username or password to update.');
      return;
    }
    setIsAccountUpdating(true);
    try {
      const response = await apiFetch('/update_account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_username: accountForm.username || null,
          new_password: accountForm.password || null
        })
      }, currentUser.token, handleLogout);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Update failed');
      }

      const data = await response.json();
      const updatedUser = { username: data.username, token: data.access_token };
      setCurrentUser(updatedUser);

      if (localStorage.getItem('currentUser')) {
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      } else {
        sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));
      }

      toast.success('Account updated successfully!');
      setAccountModal(false);
      setAccountForm({ username: '', password: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsAccountUpdating(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await apiFetch('/account', {
        method: 'DELETE',
      }, currentUser.token, handleLogout);

      if (!response.ok) {
        throw new Error('Failed to delete account');
      }

      toast.success('Account deleted successfully');
      handleLogout();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (authModal.mode === 'register' && authForm.password !== authForm.confirmPassword) {
      toast.error('Passwords do not match!');
      return;
    }
    if (authForm.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsAuthLoading(true);
    const endpoint = authModal.mode === 'login' ? '/login' : '/register';
    const payload = authModal.mode === 'register'
      ? { username: authForm.username, password: authForm.password }
      : authForm;

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentUser({ username: authForm.username, token: data.access_token });
        setAuthModal({ isOpen: false, mode: 'login' });
        setAuthForm({ username: '', password: '', confirmPassword: '' });
        toast.success(`Successfully ${authModal.mode === 'login' ? 'logged in' : 'registered'}!`);
      } else {
        toast.error(data.detail || 'Authentication failed');
      }
    } catch (err) {
      toast.error('Error connecting to server');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const getPasswordStrength = (pw) => {
    if (pw.length === 0) return { score: 0, label: '', color: 'transparent' };
    let s = 0;
    if (pw.length >= 6) s += 1;
    if (pw.length >= 8) s += 1;
    if (/[A-Z]/.test(pw)) s += 1;
    if (/[0-9]/.test(pw)) s += 1;
    if (/[^A-Za-z0-9]/.test(pw)) s += 1;
    s = Math.min(4, Math.max(1, s));
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#ef4444', '#eab308', '#22c55e', '#10b981'];
    return { score: s, label: labels[s], color: colors[s] };
  };
  const pwStrength = getPasswordStrength(authForm.password || '');
  const pwMismatch = authModal.mode === 'register' && authForm.confirmPassword.length > 0 && authForm.password !== authForm.confirmPassword;


  const getNodeIcon = (nodeName) => {
    switch (nodeName) {
      case 'researcher': return <Database size={18} />;
      case 'developer': return <Code2 size={18} />;
      case 'executor': return <Zap size={18} />;
      case 'critic': return <BrainCircuit size={18} />;
      default: return <ChevronRight size={18} />;
    }
  };

  // Log Renderer
  const renderLogContent = (state, nodeName) => {
    if (!state) return null;
    if (typeof state === 'string') return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{state}</pre>;

    // Handle Researcher Output
    if (nodeName === 'researcher' && state.context && Array.isArray(state.context)) {
      return (
        <div className="state-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--node-researcher)' }}>Vector RAG Context Retrieved:</div>
          {state.context.map((ctx, i) => {
            try {
              const parsed = JSON.parse(ctx);
              return (
                <div key={i} style={{ background: 'var(--code-bg)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', overflowX: 'auto', border: '1px solid var(--border)' }}>
                  <pre style={{ margin: 0, color: 'var(--code-text)', fontFamily: 'var(--font-mono)' }}>{JSON.stringify(parsed, null, 2)}</pre>
                </div>
              );
            } catch {
              return (
                <div key={i} style={{ background: 'var(--code-bg)', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem', overflowX: 'auto', border: '1px solid var(--border)' }}>
                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--code-text)', fontFamily: 'var(--font-mono)', lineHeight: '1.5' }}>
                    {ctx}
                  </div>
                </div>
              );
            }
          })}
        </div>
      );
    }

    // Handle Developer Output
    if (nodeName === 'developer' && state.current_code) {
      return (
        <div className="state-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--node-developer)' }}>Generated Integration Code:</div>
          <CodeBlock className="language-python">
            {state.current_code}
          </CodeBlock>
          {state.dependencies && state.dependencies.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <strong>Dependencies:</strong> {state.dependencies.join(', ')}
            </div>
          )}
        </div>
      );
    }

    // Handle Executor Output
    if (nodeName === 'executor') {
      return (
        <div className="state-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, color: state.success ? 'var(--node-success)' : 'var(--node-error)' }}>
            Execution {state.success ? 'Successful' : 'Failed'} (Iteration {state.iteration})
          </div>
          {state.stdout && (
            <div style={{ background: 'var(--code-bg)', padding: '0.75rem', borderRadius: '6px', color: 'var(--node-success)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
              {state.stdout}
            </div>
          )}
          {state.error_log && (
            <div style={{ background: 'var(--code-bg)', padding: '0.75rem', borderRadius: '6px', color: 'var(--node-error)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', whiteSpace: 'pre-wrap', border: '1px solid var(--node-error)' }}>
              {state.error_log}
            </div>
          )}
        </div>
      );
    }

    // Handle Critic Output
    if (nodeName === 'critic' && state.next_node) {
      return (
        <div className="state-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--node-critic)' }}>Routing Decision:</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Next node target: <strong>{state.next_node}</strong>
          </div>
        </div>
      );
    }

    // Fallback for generic JSON state
    return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>{JSON.stringify(state, null, 2)}</pre>;
  };

  // Derived Analytics
  const totalJobs = jobHistory.length;
  const successJobs = jobHistory.filter(j => j.status === 'completed').length;
  const successRate = totalJobs > 0 ? Math.round((successJobs / totalJobs) * 100) : 0;

  return (
    <div className="app-container">
      <Toaster position="bottom-right" toastOptions={{ style: { background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px' } }} />

      {/* Sidebar - Controls */}
      <div className={`glass-panel sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
        <div className="brand-container">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Agentic API Engine
            <button
              onClick={() => currentUser ? setAccountModal(true) : setAuthModal({ isOpen: true, mode: 'login' })}
              className="icon-btn"
              style={{ padding: '4px', color: 'var(--accent)', marginLeft: '0.25rem' }}
              aria-label="Account Settings"
              title="Account Settings"
            >
              <Settings size={22} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle Theme">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={() => setIsSidebarOpen(false)} className="theme-toggle" aria-label="Close Sidebar">
              <PanelLeftClose size={20} />
            </button>
          </div>
        </div>

        {/* User Auth & Analytics */}
        <div className="auth-section">
          {currentUser ? (
            <>
              <div className="user-profile">
                <div className="user-info" style={{ position: 'relative' }}>
                  <User size={16} />
                  <div title="System Online" style={{ position: 'absolute', bottom: '-4px', left: '-4px', width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', border: '2px solid var(--bg-panel)' }}></div>
                  <span style={{ fontWeight: '600' }}>{currentUser.username}</span>
                </div>
                <button className="icon-btn" onClick={handleLogout} title="Logout">
                  <LogOut size={16} />
                </button>
              </div>

              <div className="analytics-mini">
                <div className="stat"><span className="val">{totalJobs}</span><span className="lbl">Jobs Run</span></div>
                <div className="stat"><span className="val">{successRate}%</span><span className="lbl">Success</span></div>
              </div>
            </>
          ) : (
            <button className="primary-btn w-full" style={{ justifyContent: 'center' }} onClick={() => setAuthModal({ isOpen: true, mode: 'login' })}>
              <ShieldCheck size={18} /> Authenticate
            </button>
          )}
        </div>

        {currentUser && (
          <>
            <div className="input-group" style={{ marginTop: '0.5rem' }}>
              <label>1. Knowledge Vectorization (RAG)</label>
              <input
                type="text"
                placeholder="https://docs.stripe.com/api"
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
              />
              <button className="primary-btn" onClick={handleIngest} disabled={isIngesting || !ingestUrl}>
                <Database size={18} />
                {isIngesting ? 'Ingesting Pipeline...' : 'Index API Docs'}
              </button>
            </div>

            <div className="input-group">
              <label>2. Define Integration Task</label>
              <textarea
                ref={taskTextareaRef}
                placeholder="Write a script to fetch a random joke from the API and print the setup and punchline..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={isRunning}
                style={{ resize: 'none', overflowY: 'auto' }}
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="primary-btn" style={{ flex: 1, minWidth: '150px' }} onClick={() => handleRunAgent()} disabled={isRunning || !task}>
                  {isRunning ? <Activity size={18} className="spin-animation" /> : <Play size={18} />}
                  {isRunning ? 'Processing...' : 'Launch Agent'}
                </button>
                {isRunning && (
                  <button className="btn-cancel" onClick={handleStop} title="Stop Agent">
                    <XCircle size={18} /> Stop
                  </button>
                )}
              </div>
            </div>

            <button className="secondary-btn history-btn" style={{ marginTop: 'auto' }} onClick={openHistory} disabled={isRunning}>
              <History size={16} /> View Job History
            </button>
          </>
        )}
      </div>

      {/* Mobile Overlay (Only visible on small screens when sidebar is open) */}
      <div
        className="mobile-overlay"
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      ></div>

      {/* Main Area */}
      <div className="glass-panel main-area" style={{ padding: currentUser ? '0' : '3rem' }}>
        {!currentUser ? (
          <div className="welcome-hero">
            <div className="hero-icon"><BrainCircuit size={64} color="var(--accent)" /></div>
            <h1>Welcome to Agentic API Engine</h1>
            <p className="hero-subtitle">The enterprise-grade autonomous system for self-writing API integrations, featuring vector RAG, self-healing execution, and persistent logging.</p>

            <div className="hero-features">
              <div className="feature"><ShieldCheck size={24} /> Secure multi-tenant architecture</div>
              <div className="feature"><Activity size={24} /> Real-time SSE Execution Streaming</div>
              <div className="feature"><Code2 size={24} /> Auto-executing Sandboxed Sandpit</div>
              <div className="feature"><History size={24} /> Persistent PostgreSQL History</div>
            </div>

            <button className="primary-btn hero-cta" onClick={() => setAuthModal({ isOpen: true, mode: 'register' })}>
              Get Started Now
            </button>
          </div>
        ) : (
          <>
            <div className="main-header">
              <div className="main-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {!isSidebarOpen && (
                  <button className="theme-toggle" onClick={() => setIsSidebarOpen(true)} title="Open Sidebar">
                    <PanelLeftOpen size={18} />
                  </button>
                )}
                <Terminal size={20} color="var(--accent)" />
                Live Execution Stream
              </div>
              <div className="header-actions">
                <button className="icon-btn" onClick={clearLogs} title="Clear Console" disabled={logs.length === 0}><Trash2 size={16} /></button>
              </div>
            </div>

            <div className="info-banner" id="system-info-banner">
              <div className="banner-content" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={18} color="var(--accent)" />
                <span><strong>System active:</strong> WebSocket stream is connected. The agent may request your feedback during execution.</span>
              </div>
              <button className="icon-btn" onClick={() => document.getElementById('system-info-banner').style.display = 'none'} style={{ color: 'var(--text-secondary)' }}>
                <XCircle size={16} />
              </button>
            </div>

            <div className="log-stream" ref={scrollContainerRef} onScroll={handleScroll} style={{ position: 'relative' }}>
              {hitlPrompt && (
                <div className="hitl-modal" style={{ background: 'var(--panel-bg)', border: '1px solid var(--border)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 10, position: 'relative' }}>
                  <h3 style={{ marginTop: 0, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <BrainCircuit size={20} /> Human-in-the-Loop Required
                  </h3>
                  <p style={{ fontSize: '0.9rem', opacity: 0.9 }}>{hitlPrompt.message}</p>
                  <form onSubmit={submitFeedback} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                    <input
                      type="text"
                      className="glass-input"
                      style={{ flex: 1 }}
                      placeholder="Provide a hint or feedback (or leave blank to resume)..."
                      value={hitlInput}
                      onChange={e => setHitlInput(e.target.value)}
                    />
                    <button type="submit" className="primary-btn">Resume</button>
                  </form>
                </div>
              )}

              {isRunning && <div className="pulse-bar"></div>}

              {logs.length === 0 ? (
                <div className="empty-state" style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '4rem' }}>
                  <Sparkles size={48} className="text-accent mb-4" />
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontWeight: 600 }}>Ready to assist</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Define a task manually or pick a quick start below to instantly populate the prompt.</p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'left' }}>
                    {[
                      { icon: <Database size={20} className="text-accent" />, title: "Weather API", task: "Query an open weather API for the current temperature in London and extract the exact float value." },
                      { icon: <Code2 size={20} className="text-accent" />, title: "Random Joke", task: "Write a script to fetch a random joke from the official API and print the setup and punchline" },
                      { icon: <Activity size={20} className="text-accent" />, title: "Stripe Customers", task: "Using the Stripe API documentation ingested, write python code to list the last 5 customers." },
                      { icon: <Zap size={20} className="text-accent" />, title: "GitHub Repos", task: "Fetch my public GitHub repositories and format them into a neat markdown table." }
                    ].map((item, i) => (
                      <div key={i} className="quick-start-card" onClick={() => setTask(item.task)}>
                        <div style={{ marginBottom: '0.5rem' }}>{item.icon}</div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>{item.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.task.substring(0, 50)}...</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="log-entry" style={{ animationDelay: `${index * 50}ms` }}>
                    <div className="log-meta">
                      <span className="node-badge">
                        {getNodeIcon(log.node)}
                        {log.node}
                      </span>
                      {log.state && log.state.success !== undefined && (
                        <span className={`status-badge ${log.state.success ? 'status-success' : 'status-failed'}`}>
                          {log.state.success ? 'Success' : 'Failed'}
                        </span>
                      )}
                    </div>
                    <div className="log-content">
                      {renderLogContent(log.state, log.node)}
                    </div>
                  </div>
                ))
              )}
              <div ref={streamEndRef} style={{ height: '1px' }} />
            </div>

            {/* Smart scroll button */}
            {isScrolledUp && (
              <button
                className="scroll-bottom-btn"
                onClick={() => { setIsScrolledUp(false); streamEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
              >
                <ArrowDownCircle size={20} /> Back to Bottom
              </button>
            )}
          </>
        )}
      </div>

      {/* Modals */}

      {/* Auth Modal */}
      {authModal.isOpen && (
        <div className="modal-overlay auth-overlay">
          <div className={`modal-content auth-modal ${authModal.mode}`}>
            <div className="modal-header">
              {authModal.mode === 'login' ? 'Account Login' : 'Create Account'}
              <button className="icon-btn" onClick={() => setAuthModal({ ...authModal, isOpen: false })}><XCircle size={20} /></button>
            </div>
            <form onSubmit={handleAuthSubmit}>
              <div className="modal-body">
                <div className="input-group">
                  <label>Username</label>
                  <div className="input-with-icon">
                    <User size={16} className="input-icon" />
                    <input
                      ref={usernameInputRef}
                      type="text"
                      required
                      value={authForm.username}
                      onChange={e => setAuthForm({ ...authForm, username: e.target.value })}
                      style={{ paddingLeft: '2.5rem' }}
                    />
                  </div>
                </div>
                <div className="input-group">
                  <label>Password</label>
                  <div className="password-input-wrapper input-with-icon">
                    <Lock size={16} className="input-icon" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      value={authForm.password}
                      onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                      style={{ paddingLeft: '2.5rem' }}
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex="-1">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {authModal.mode === 'register' && (
                  <>
                    <div className="pw-strength-container" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                      <div className="pw-strength-bar" style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                        {[1, 2, 3, 4].map(i => (
                          <div key={i} className="pw-block" style={{ height: '4px', flex: 1, borderRadius: '2px', backgroundColor: pwStrength.score >= i ? pwStrength.color : 'var(--border)', transition: 'background-color 0.3s ease' }}></div>
                        ))}
                      </div>
                      <div className="pw-label" style={{ color: pwStrength.color, fontSize: '0.75rem', textAlign: 'right', fontWeight: 600, minHeight: '14px' }}>
                        {pwStrength.label}
                      </div>
                    </div>

                    <div className={`input-group ${pwMismatch ? 'has-error' : ''}`}>
                      <label>Confirm Password</label>
                      <div className="password-input-wrapper input-with-icon">
                        <Lock size={16} className="input-icon" />
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          minLength={6}
                          value={authForm.confirmPassword}
                          onChange={e => setAuthForm({ ...authForm, confirmPassword: e.target.value })}
                          style={{ paddingLeft: '2.5rem', borderColor: pwMismatch ? 'var(--error)' : undefined }}
                        />
                        <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex="-1">
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {pwMismatch && <div className="error-text">Passwords do not match</div>}
                    </div>
                  </>
                )}

                {authModal.mode === 'login' && (
                  <div className="remember-me-toggle">
                    <input type="checkbox" id="rememberMe" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    <label htmlFor="rememberMe">Remember me for 7 days</label>
                  </div>
                )}

                <div style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--accent)', cursor: 'pointer', textAlign: 'center' }}
                  onClick={() => setAuthModal({ ...authModal, mode: authModal.mode === 'login' ? 'register' : 'login' })}>
                  {authModal.mode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setAuthModal({ ...authModal, isOpen: false })} disabled={isAuthLoading}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={isAuthLoading || pwMismatch}>
                  {isAuthLoading ? <Loader2 size={16} className="spin-animation" /> : (authModal.mode === 'login' ? 'Login' : 'Register')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="modal-overlay">
          <div className="modal-content history-modal" style={{ maxWidth: '700px', width: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Execution History</span>
              <button className="icon-btn" onClick={() => setHistoryModal(false)}><XCircle size={20} /></button>
            </div>
            <div className="modal-body history-list">
              <div style={{ marginBottom: '1rem' }}>
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={historySearchTerm}
                  onChange={(e) => setHistorySearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                />
              </div>
              {isLoadingHistory ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
              ) : jobHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No previous jobs found.</div>
              ) : (
                jobHistory.filter(job => job.task.toLowerCase().includes(historySearchTerm.toLowerCase())).map(job => (
                  <div key={job.id} className="history-item">
                    <div className="history-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span className={`status-badge ${job.status === 'completed' ? 'status-success' : job.status === 'failed' ? 'status-failed' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', fontSize: '0.7rem' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: job.status === 'completed' ? 'var(--node-success)' : job.status === 'failed' ? 'var(--node-error)' : 'var(--accent)' }}></span>
                        {job.status}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span className="history-time" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={12} /> {new Date(job.created_at + (job.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}</span>
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="icon-btn hover-danger"
                          title="Delete Job"
                          style={{ color: 'var(--text-secondary)', padding: '4px' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="history-task">{job.task}</div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      <button className="secondary-btn history-retry-btn" onClick={() => handleRetryJob(job.id)}>
                        <RefreshCcw size={14} /> Retry
                      </button>
                      {job.logs && (
                        <button className="secondary-btn" onClick={() => setViewLogModal({ isOpen: true, logs: job.logs })}>
                          <Code2 size={14} /> View Logs
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* View Log Modal */}
      {viewLogModal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content history-modal" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Saved Execution Logs</span>
              <button className="icon-btn" onClick={() => setViewLogModal({ isOpen: false, logs: '' })}><XCircle size={20} /></button>
            </div>
            <div className="modal-body" style={{ padding: '1rem', maxHeight: '70vh', overflowY: 'auto', backgroundColor: 'var(--bg-document)', borderRadius: '8px', marginTop: '1rem' }}>
              {viewLogModal.logs ? viewLogModal.logs.split('\n').map((l, i) => {
                if (!l) return null;
                try {
                  const j = JSON.parse(l);
                  return (
                    <div key={i} className="log-entry" style={{ marginBottom: '1rem' }}>
                      <div className="log-meta">
                        <span className="node-badge">{j.node}</span>
                      </div>
                      <div className="log-content">
                        {renderLogContent(j.state, j.node)}
                      </div>
                    </div>
                  );
                } catch {
                  return <div key={i} style={{ color: 'var(--error)' }}>{l}</div>;
                }
              }) : <div style={{ color: 'var(--text-secondary)' }}>No logs recorded for this run.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Account Settings Modal */}
      {accountModal && (
        <div className="modal-overlay auth-overlay">
          <div className="modal-content auth-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Account Settings
              <button className="icon-btn" onClick={() => { setAccountModal(false); setShowDeleteConfirm(false); }}><XCircle size={20} /></button>
            </div>

            {showDeleteConfirm ? (
              <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: 'var(--node-error)' }}>
                  <XCircle size={48} />
                </div>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', fontSize: '1.2rem' }}>Delete Account?</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                  This action is completely irreversible. All your integrated API jobs and configuration data will be permanently lost.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <button type="button" className="secondary-btn" onClick={() => setShowDeleteConfirm(false)} style={{ margin: 0, flex: 1 }}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn" onClick={handleDeleteAccount} style={{ margin: 0, flex: 1, backgroundColor: 'var(--node-error)' }}>
                    Yes, Delete
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleUpdateAccount}>
                <div className="modal-body">
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Update your username or password</p>

                  <div className="input-group">
                    <label>New Username (Optional)</label>
                    <div className="input-with-icon">
                      <User size={16} className="input-icon" />
                      <input
                        type="text"
                        placeholder={currentUser?.username}
                        value={accountForm.username}
                        onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })}
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

                  <div className="input-group">
                    <label>New Password (Optional)</label>
                    <div className="password-input-wrapper input-with-icon">
                      <Lock size={16} className="input-icon" />
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter new password"
                        value={accountForm.password}
                        onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                        style={{ paddingLeft: '2.5rem' }}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex="-1"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0 1.5rem 1.5rem 1.5rem' }}>
                  <button type="submit" className="primary-btn auth-submit" disabled={isAccountUpdating} style={{ margin: 0 }}>
                    {isAccountUpdating ? <><Loader2 size={16} className="spin-animation" /> Updating...</> : 'Update Account'}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{ color: 'var(--node-error)', borderColor: 'var(--node-error)', margin: 0 }}
                  >
                    Delete Account
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
