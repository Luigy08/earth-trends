import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { ArrowForward, ArrowOutward, Menu, Public, ScienceOutlined, SettingsOutlined } from '@mui/icons-material';
import type { Analysis } from '../shared/types';
import type { NavigationPage } from './app.types';
import { isConfigured } from './services/firebase';
import { useAnalysis } from './analysis/useAnalysis';
import { useSessions } from './analysis/useSessions';
import { Sidebar } from './components/Sidebar';
import { Globe } from './components/Globe';
import { ConversationWorkspace } from './components/ConversationWorkspace';
import { MeteomaticsWorkspace } from './components/MeteomaticsWorkspace';
import { Results } from './components/Results';
import { MethodologyDialog, SetupDialog } from './components/InformationDialogs';
import { AnalysesPage, RealtimePage } from './components/SecondaryPages';

export function App() {
  const [page, setPage] = useState<NavigationPage>('explore');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [queryWorkflow, setQueryWorkflow] = useState<'trend' | 'meteomatics'>('trend');
  const { analysis, history, busy: analysisBusy, error: analysisError, submit, retry, select, clear, canRetry } = useAnalysis();
  const restoreAnalysis = useCallback((item: Analysis | null) => { if (item) select(item); else clear(); }, [select, clear]);
  const sessions = useSessions(restoreAnalysis);
  const restoredWorkflow = useRef(false);
  useEffect(() => {
    if (!restoredWorkflow.current && sessions.current) {
      restoredWorkflow.current = true;
      if (sessions.current.workflow === 'meteomatics') setQueryWorkflow('meteomatics');
    }
  }, [sessions.current]);
  const navigate = (next: NavigationPage) => { setPage(next); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const confirmAnalysis = async (spec: NonNullable<typeof sessions.proposal>) => {
    const analysisId = await submit(spec);
    if (analysisId) await sessions.submit(analysisId);
    window.setTimeout(() => document.getElementById('evidencia')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to main content</a>
    <Sidebar page={page} onNavigate={navigate} onMethodology={() => setMethodologyOpen(true)} open={sidebarOpen} onClose={() => setSidebarOpen(false)} sessions={sessions.sessions} currentSessionId={sessions.current?.id} onNewSession={() => { void sessions.create(); navigate('explore'); }} onOpenSession={item => { void sessions.open(item); setQueryWorkflow(item.workflow === 'meteomatics' ? 'meteomatics' : 'trend'); navigate('explore'); }} onRenameSession={(item, title) => { void sessions.rename(item, title); }} onDeleteSession={item => { void sessions.remove(item); }} />
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><IconButton className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu /></IconButton><Public fontSize="small" /><span>Climate observatory</span><span className="breadcrumb-slash">/</span><strong>{page === 'explore' ? 'Explore' : page === 'analyses' ? 'My analyses' : 'Real-time'}</strong></div><div className="topbar-right"><span className="poc-label"><i />A PROJECT FOR EXPLORATION</span><Chip label="POC · v.01" size="small" variant="outlined" /><Tooltip title="Connection status"><IconButton size="small" onClick={() => setSetupOpen(true)} aria-label="View configuration"><SettingsOutlined fontSize="small" /></IconButton></Tooltip></div></header>
      <main id="main-content"><div className={`connection-banner ${isConfigured ? 'configured' : ''}`}><span className="connection-dot" /><span>{isConfigured ? 'Configuration present' : 'Explore mode'}<span className="connection-description">{isConfigured ? ' · Firebase and provider access are verified when a request succeeds.' : ' · Browse the interface. Configure Firebase to start exploring live data.'}</span></span><button onClick={() => setSetupOpen(true)}>{isConfigured ? 'View configuration' : 'Configure connection'}<ArrowOutward /></button></div>
        {page === 'explore' && <><section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line" />FOLLOW YOUR CURIOSITY. FIND THE EVIDENCE.</span><h1>Climate changes.<br /><em>Ask the questions.</em></h1><p>Explore how our planet is changing, one question at a time.<br className="desktop-break" /> Open data, clear trends, and science within reach.</p><div className="hero-source"><span className="source-pill"><span className="mini-orbit">✳</span> METEOMATICS DATA</span><span>Historical perspective. Curiosity without limits.</span></div></div><Globe /></section>
          <section className="query-mode-picker"><div><span className="eyebrow">CHOOSE A METEOMATICS WORKFLOW</span><p>Historical trend analysis uses Meteomatics daily aggregates. The API workflow runs separate requests with the exact options you choose.</p></div><ToggleButtonGroup exclusive size="small" value={queryWorkflow} onChange={(_, value) => { if (value) setQueryWorkflow(value); }} aria-label="Data source workflow"><ToggleButton value="trend">Historical trend analysis</ToggleButton><ToggleButton value="meteomatics">Meteomatics API</ToggleButton></ToggleButtonGroup></section>
          <div hidden={queryWorkflow !== 'trend'}><ConversationWorkspace messages={sessions.messages} proposal={sessions.proposal} busy={sessions.busy} error={sessions.error} analysisBusy={analysisBusy} sessionReady={Boolean(sessions.current)} onSend={message => { void sessions.send(message); }} onConfirm={spec => { void confirmAnalysis(spec); }} />
          <Results analysis={analysis} busy={analysisBusy} error={analysisError} onRetry={retry} canRetry={canRetry} onMethodology={() => setMethodologyOpen(true)} /></div>
          <div hidden={queryWorkflow !== 'meteomatics'}>{queryWorkflow === 'meteomatics' && sessions.current && !sessions.busy && <MeteomaticsWorkspace key={sessions.current.id} sessionId={sessions.current.id} onSessionUpdated={sessions.updateSession} />}</div>
        </>}
        {page === 'analyses' && <AnalysesPage history={history} onSelect={item => { select(item); navigate('explore'); setTimeout(() => document.getElementById('evidencia')?.scrollIntoView({ behavior: 'smooth' }), 100); }} onExplore={() => navigate('explore')} />}
        {page === 'realtime' && <RealtimePage analysis={analysis} onExplore={() => navigate('explore')} />}
        <footer className="site-footer"><span><span className="footer-mark">✳</span> Made to ask better questions.</span><span>Earth Trend Detective <span className="footer-dot">·</span> NASA Space Apps POC</span><Button size="small" onClick={() => setMethodologyOpen(true)} endIcon={<ArrowForward />}>Open science<ScienceOutlined fontSize="small" /></Button></footer>
      </main></div><SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} /><MethodologyDialog open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
  </div>;
}
