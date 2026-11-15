import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Avatar, IconButton, Tooltip } from '@mui/material';
import { ArrowOutward, Logout, Menu, SettingsOutlined } from '@mui/icons-material';
import type { User } from 'firebase/auth';
import type { Analysis } from '../shared/types';
import type { NavigationPage, QueryWorkflow } from './app.types';
import { isConfigured } from './services/firebase';
import { useAnalysis } from './analysis/useAnalysis';
import { useSessions } from './analysis/useSessions';
import { Sidebar } from './components/Sidebar';
import { ConversationWorkspace } from './components/ConversationWorkspace';
import { MeteomaticsWorkspace } from './components/MeteomaticsWorkspace';
import { GiovanniWorkspace } from './components/GiovanniWorkspace';
import { EarthdataWorkspace } from './components/EarthdataWorkspace';
import { QUERY_ASSISTANT_NAMES } from './app.constant';
import { WorkflowSelect } from './components/WorkflowSelect';
import { ChatComposer, ChatGreeting } from './components/ChatComposer';
import { DictationButton } from './components/DictationButton';
import { Results } from './components/Results';
import { MethodologyDialog, SetupDialog } from './components/InformationDialogs';
import { AnalysesPage, RealtimePage } from './components/SecondaryPages';

export function App({ user, onSignOut }: { user?: User; onSignOut?: () => void }) {
  const [page, setPage] = useState<NavigationPage>('explore');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [queryWorkflow, setQueryWorkflow] = useState<QueryWorkflow>('meteomatics');
  const { analysis, history, busy: analysisBusy, error: analysisError, submit, retry, select, clear, canRetry } = useAnalysis();
  const restoreAnalysis = useCallback((item: Analysis | null) => { if (item) select(item); else clear(); }, [select, clear]);
  const sessions = useSessions(restoreAnalysis);
  const restoredSessionId = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Sessions saved by the Meteomatics, Giovanni or Earthdata chats are tagged; trend sessions are recognized by their conversation or analysis.
    if (sessions.busy || !sessions.current || restoredSessionId.current === sessions.current.id) return;
    restoredSessionId.current = sessions.current.id;
    const { workflow } = sessions.current;
    if (workflow === 'meteomatics' || workflow === 'giovanni' || workflow === 'earthdata') { setQueryWorkflow(workflow); return; }
    const isTrend = workflow === 'trend' || Boolean(sessions.current.analysisId) || sessions.messages.length > 0;
    setQueryWorkflow(isTrend ? 'trend' : 'meteomatics');
  }, [sessions.busy, sessions.current, sessions.messages.length]);
  const navigate = (next: NavigationPage) => { setPage(next); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const confirmAnalysis = async (spec: NonNullable<typeof sessions.proposal>) => {
    const analysisId = await submit(spec);
    if (analysisId) await sessions.submit(analysisId);
    window.setTimeout(() => document.getElementById('evidencia')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };
  const workflowSelect = <WorkflowSelect value={queryWorkflow} onChange={setQueryWorkflow} />;
  const showResults = Boolean(analysis || analysisBusy || analysisError);
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to main content</a>
    <Sidebar page={page} onNavigate={navigate} onMethodology={() => setMethodologyOpen(true)} open={sidebarOpen} onClose={() => setSidebarOpen(false)} sessions={sessions.sessions} currentSessionId={sessions.current?.id} onNewSession={() => { void sessions.create(); navigate('explore'); }} onOpenSession={item => { void sessions.open(item); navigate('explore'); }} onRenameSession={(item, title) => { void sessions.rename(item, title); }} onDeleteSession={item => { void sessions.remove(item); }} />
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><IconButton className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu /></IconButton><span className="topbar-title">{page === 'explore' ? sessions.current?.title ?? 'New session' : page === 'analyses' ? 'My analyses' : 'Real-time'}</span></div><div className="topbar-right"><Tooltip title="Connection status"><IconButton size="small" onClick={() => setSetupOpen(true)} aria-label="View configuration"><SettingsOutlined fontSize="small" /></IconButton></Tooltip>{user && <span className="topbar-user"><Tooltip title={user.email ?? user.displayName ?? 'Signed in'}><Avatar src={user.photoURL ?? undefined} alt={user.displayName ?? 'Signed-in user'} slotProps={{ img: { referrerPolicy: 'no-referrer' } }}>{(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}</Avatar></Tooltip>{onSignOut && <Tooltip title="Sign out"><IconButton size="small" onClick={onSignOut} aria-label="Sign out"><Logout fontSize="small" /></IconButton></Tooltip>}</span>}</div></header>
      <main id="main-content" className={page === 'explore' ? 'chat-main' : undefined}>{!isConfigured && <div className="connection-banner"><span className="connection-dot" /><span>Explore mode<span className="connection-description"> · Configure Firebase to start exploring live data.</span></span><button onClick={() => setSetupOpen(true)}>Configure connection<ArrowOutward /></button></div>}
        {page === 'explore' && <>
          {queryWorkflow !== 'trend' && sessions.current && !sessions.busy && sessions.error && <Alert severity="error" className="chat-alert">{sessions.error}</Alert>}
          {queryWorkflow === 'trend' && <ConversationWorkspace messages={sessions.messages} proposal={sessions.proposal} busy={sessions.busy} error={sessions.error} analysisBusy={analysisBusy} sessionReady={Boolean(sessions.current)} onSend={message => { void sessions.send(message); }} onConfirm={spec => { void confirmAnalysis(spec); }} tools={workflowSelect}>
            {showResults && <Results analysis={analysis} busy={analysisBusy} error={analysisError} onRetry={retry} canRetry={canRetry} onMethodology={() => setMethodologyOpen(true)} />}
          </ConversationWorkspace>}
          {queryWorkflow !== 'trend' && (sessions.current && !sessions.busy
            ? queryWorkflow === 'earthdata'
              ? <EarthdataWorkspace key={sessions.current.id} sessionId={sessions.current.id} onSessionUpdated={sessions.updateSession} tools={workflowSelect} />
              : queryWorkflow === 'giovanni'
              ? <GiovanniWorkspace key={sessions.current.id} sessionId={sessions.current.id} onSessionUpdated={sessions.updateSession} tools={workflowSelect} />
              : <MeteomaticsWorkspace key={sessions.current.id} sessionId={sessions.current.id} onSessionUpdated={sessions.updateSession} tools={workflowSelect} />
            : <section className="chat-workspace is-empty" aria-label={`${QUERY_ASSISTANT_NAMES[queryWorkflow]} query assistant`}><ChatGreeting />{sessions.error && <Alert severity="error" className="chat-alert">{sessions.error}</Alert>}<div className="chat-dock"><ChatComposer value="" onChange={() => undefined} onSubmit={() => undefined} ariaLabel={`Message the ${QUERY_ASSISTANT_NAMES[queryWorkflow]} assistant`} maxLength={2000} disabled canSubmit={false} placeholder={sessions.busy ? 'Connecting to your session…' : 'Session unavailable — check the message above'} tools={workflowSelect} actions={<DictationButton disabled onTranscript={() => undefined} />} /></div></section>)}
        </>}
        {page === 'analyses' && <AnalysesPage history={history} onSelect={item => { select(item); setQueryWorkflow('trend'); navigate('explore'); setTimeout(() => document.getElementById('evidencia')?.scrollIntoView({ behavior: 'smooth' }), 100); }} onExplore={() => navigate('explore')} />}
        {page === 'realtime' && <RealtimePage analysis={analysis} onExplore={() => navigate('explore')} />}
      </main></div><SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} /><MethodologyDialog open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
  </div>;
}
