import React, { useState } from 'react';
import { InputForm } from './components/InputForm';
import { VideoPlayer } from './components/VideoPlayer';
import { AppState, VideoInputData, GeneratedScript, SocialAccount, ScheduledPost, TargetPlatform } from './types';
import { generateVideoScript, validateContentSafety } from './services/geminiService';
import { Video, Layers, BarChart3, AlertCircle, Share2, Calendar, ShieldAlert } from 'lucide-react';

// --- MOCK COMPONENTS FOR DASHBOARD TABS ---
const AccountsView = () => {
    const [accounts, setAccounts] = useState<SocialAccount[]>([
        { id: '1', platform: TargetPlatform.TIKTOK, username: '@viral_user', avatarUrl: '', connected: true, status: 'active' },
        { id: '2', platform: TargetPlatform.REELS, username: '', avatarUrl: '', connected: false, status: 'expired' },
    ]);

    const toggleConnect = (id: string) => {
        setAccounts(accounts.map(acc => acc.id === id ? {...acc, connected: !acc.connected, username: !acc.connected ? '@new_user' : ''} : acc));
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
            <h2 className="text-3xl font-bold">Connected Accounts</h2>
            <div className="grid gap-4">
                {accounts.map(acc => (
                    <div key={acc.id} className="bg-gray-800 p-6 rounded-2xl flex items-center justify-between border border-gray-700">
                        <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${acc.platform === TargetPlatform.TIKTOK ? 'bg-black text-white' : 'bg-pink-600 text-white'}`}>
                                {acc.platform === TargetPlatform.TIKTOK ? 'T' : 'I'}
                            </div>
                            <div>
                                <h3 className="font-bold text-lg">{acc.platform}</h3>
                                <p className="text-gray-400">{acc.connected ? `Connected as ${acc.username}` : 'Not connected'}</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => toggleConnect(acc.id)}
                            className={`px-4 py-2 rounded-lg font-bold ${acc.connected ? 'bg-red-500/20 text-red-400' : 'bg-brand-600 text-white'}`}
                        >
                            {acc.connected ? 'Disconnect' : 'Connect via OAuth'}
                        </button>
                    </div>
                ))}
            </div>
            <p className="text-sm text-gray-500 bg-gray-900 p-4 rounded-xl border border-gray-800">
                Note: OAuth integration requires backend verification. This is a UI simulation for the "Automation" module.
            </p>
        </div>
    );
};

const ScheduleView = () => {
    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
             <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold">Smart Schedule</h2>
                <button className="bg-brand-600 text-white px-4 py-2 rounded-lg font-bold">+ New Post</button>
             </div>
             <div className="bg-gray-800 rounded-2xl p-8 text-center border border-gray-700">
                 <Calendar className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                 <h3 className="text-xl font-bold text-gray-300">No posts scheduled</h3>
                 <p className="text-gray-500">Generate a video first to schedule it.</p>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                     <h4 className="text-brand-400 font-bold mb-2">Best Time (TikTok)</h4>
                     <p className="text-2xl font-bold">18:00 - 20:00</p>
                     <p className="text-xs text-gray-500">Based on your niche</p>
                 </div>
                 <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                     <h4 className="text-pink-400 font-bold mb-2">Best Time (Reels)</h4>
                     <p className="text-2xl font-bold">12:00 - 13:00</p>
                     <p className="text-xs text-gray-500">Based on engagement</p>
                 </div>
             </div>
        </div>
    )
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('input');
  const [script, setScript] = useState<GeneratedScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complianceError, setComplianceError] = useState<{title: string, msg: string} | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  const handleGenerate = async (data: VideoInputData) => {
    setAppState('generating');
    setError(null);
    setComplianceError(null);

    try {
      // 1. COMPLIANCE CHECK
      setStatusMsg("Running Compliance Check (TikTok/Meta Policy)...");
      const safetyCheck = await validateContentSafety(data.productName, data.description);
      
      if (!safetyCheck.isSafe) {
          setComplianceError({
              title: "Compliance Violation Detected",
              msg: `Reason: ${safetyCheck.reason}. Suggestion: ${safetyCheck.suggestion}`
          });
          setAppState('input');
          return;
      }

      // 2. GENERATE SCRIPT
      setStatusMsg("Generating Script & Optimizing SEO...");
      const generatedScript = await generateVideoScript(data);
      generatedScript.complianceCheck = safetyCheck;
      
      setScript(generatedScript);
      setAppState('preview');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate video script.");
      setAppState('input');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-500 cursor-pointer" onClick={() => setAppState('input')}>
            <Video size={28} />
            <span className="text-xl font-black tracking-tight text-white">Viralize<span className="text-brand-500">Pro</span></span>
          </div>
          
          {/* Main Nav */}
          <nav className="hidden md:flex items-center gap-1 bg-gray-800/50 p-1 rounded-lg border border-gray-700/50">
             <button onClick={() => setAppState('input')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appState === 'input' || appState === 'preview' || appState === 'generating' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>Create</button>
             <button onClick={() => setAppState('accounts')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appState === 'accounts' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>Accounts</button>
             <button onClick={() => setAppState('schedule')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appState === 'schedule' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>Schedule</button>
             <button onClick={() => setAppState('analytics')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${appState === 'analytics' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>Analytics</button>
          </nav>

          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-600 border border-white/20 shadow-lg"></div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 md:p-8">
        
        {/* Global Alerts */}
        {error && (
          <div className="max-w-2xl mx-auto w-full mb-6 bg-red-900/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2">
            <AlertCircle size={20} />
            <p>{error}</p>
          </div>
        )}

        {complianceError && (
          <div className="max-w-3xl mx-auto w-full mb-6 bg-orange-900/30 border border-orange-500/50 text-orange-200 p-6 rounded-2xl flex items-start gap-4 animate-in slide-in-from-top-2">
            <ShieldAlert size={32} className="shrink-0 text-orange-500" />
            <div>
                <h3 className="font-bold text-lg text-orange-400 mb-1">{complianceError.title}</h3>
                <p className="text-orange-100/80 mb-2">{complianceError.msg}</p>
                <div className="text-xs bg-black/30 p-2 rounded text-orange-300 font-mono">
                    ViralizePro Intelligence Blocked this generation to protect your account.
                </div>
            </div>
          </div>
        )}

        {/* View Switcher */}
        {appState === 'input' && (
          <div className="flex-1 flex items-center justify-center animate-in fade-in duration-500">
            <InputForm onSubmit={handleGenerate} isGenerating={false} />
          </div>
        )}

        {appState === 'generating' && (
           <div className="flex-1 flex items-center justify-center">
            <InputForm onSubmit={() => {}} isGenerating={true} statusMessage={statusMsg} />
           </div>
        )}

        {appState === 'preview' && script && (
          <div className="animate-in slide-in-from-bottom-8 duration-700">
             <VideoPlayer script={script} onEditRequest={() => setAppState('input')} />
          </div>
        )}

        {appState === 'accounts' && <AccountsView />}
        {appState === 'schedule' && <ScheduleView />}
        {appState === 'analytics' && (
            <div className="max-w-4xl mx-auto text-center py-20 animate-in fade-in">
                <BarChart3 className="w-24 h-24 mx-auto text-gray-700 mb-4"/>
                <h2 className="text-3xl font-bold text-gray-500">Analytics Module</h2>
                <p className="text-gray-600 mt-2">Generate and post videos to unlock A/B testing data.</p>
            </div>
        )}

      </main>

      <footer className="border-t border-gray-800 py-6 text-center text-gray-600 text-sm">
        <p>© 2025 Viralize Pro AI. Automated Intelligent Marketing.</p>
      </footer>
    </div>
  );
};

export default App;
